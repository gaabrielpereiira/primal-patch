import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, RefreshCw, Loader2, Plug, ArrowLeft } from "lucide-react";
import { ConversationList } from "@/components/chat/ConversationList";
import { MessageList } from "@/components/chat/MessageList";
import { MessageComposer } from "@/components/chat/MessageComposer";
import { WaAvatar } from "@/components/chat/WaAvatar";
import { useAvatarUrls } from "@/components/chat/useAvatarUrls";
import {
  conversationTitle,
  formatPhone,
  isWindowOpen,
  type WaConversation,
  type WaMessage,
} from "@/components/chat/types";

export default function Chat() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { orgId } = useOrg();
  const { toast } = useToast();

  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [search, setSearch] = useState("");
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const avatarFor = useAvatarUrls(conversations);

  const active = useMemo(
    () => conversations.find((c) => c.zernio_conversation_id === conversationId) ?? null,
    [conversations, conversationId],
  );

  const callZernio = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      const { data, error } = await supabase.functions.invoke("zernio-connect", {
        body: { action, org_id: orgId, ...payload },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error(String((data as any).error));
      return data as any;
    },
    [orgId],
  );

  const loadConversations = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await (supabase as any)
      .from("whatsapp_conversations")
      .select("*")
      .eq("org_id", orgId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) {
      toast({ title: "Erro ao carregar conversas", description: error.message, variant: "destructive" });
    } else {
      setConversations((data ?? []) as WaConversation[]);
    }
    setLoadingConvs(false);
  }, [orgId, toast]);

  const loadMessages = useCallback(
    async (convRowId: string) => {
      setLoadingMsgs(true);
      const { data, error } = await (supabase as any)
        .from("whatsapp_messages")
        .select("*")
        .eq("conversation_id", convRowId)
        .order("sent_at", { ascending: true })
        .limit(500);
      if (error) {
        toast({ title: "Erro ao carregar mensagens", description: error.message, variant: "destructive" });
      } else {
        setMessages((data ?? []) as WaMessage[]);
      }
      setLoadingMsgs(false);
    },
    [toast],
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // Busca as fotos que ainda faltam, uma vez por carga da tela
  useEffect(() => {
    if (!orgId || loadingConvs) return;
    if (!conversations.some((c) => !c.avatar_url)) return;
    let cancelled = false;
    void callZernio("refresh_avatars")
      .then((res) => {
        if (!cancelled && res?.updated) void loadConversations();
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, loadingConvs]);

  // Realtime: novas conversas e mensagens
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`wa-inbox-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations", filter: `org_id=eq.${orgId}` },
        () => void loadConversations(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_messages", filter: `org_id=eq.${orgId}` },
        (payload) => {
          const row = payload.new as WaMessage | undefined;
          if (!row || !active || row.conversation_id !== active.id) return;
          setMessages((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev.map((m) => (m.id === row.id ? row : m))
              : [...prev, row],
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, active, loadConversations]);

  useEffect(() => {
    if (!active) {
      setMessages([]);
      return;
    }
    void loadMessages(active.id);
    void callZernio("sync_messages", { conversation_id: active.zernio_conversation_id })
      .then(() => loadMessages(active.id))
      .catch(() => null);
    if (!active.avatar_url) {
      void callZernio("refresh_avatars", { conversation_ids: [active.zernio_conversation_id] })
        .then((res) => (res?.updated ? loadConversations() : null))
        .catch(() => null);
    }
    if (active.unread_count > 0) {
      void callZernio("mark_read", { conversation_id: active.zernio_conversation_id }).catch(() => null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await callZernio("register_webhook");
      await callZernio("sync_conversations");
      await callZernio("refresh_avatars").catch(() => null);
      await loadConversations();
      toast({ title: "Conversas sincronizadas" });
    } catch (e: any) {
      toast({
        title: "Não foi possível sincronizar",
        description: e?.message === "not_connected" ? "Conecte o WhatsApp (Zernio) nas integrações." : e?.message,
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleSend = async (text: string) => {
    if (!active) return;
    try {
      await callZernio("send_message", { conversation_id: active.zernio_conversation_id, message: text });
      await loadMessages(active.id);
      await loadConversations();
    } catch (e: any) {
      toast({ title: "Falha ao enviar", description: e?.message, variant: "destructive" });
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        conversationTitle(c).toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q.replace(/\D+/g, "")),
    );
  }, [conversations, search]);

  const windowOpen = isWindowOpen(active);

  return (
    <div className="flex h-[calc(100dvh-9.5rem)] flex-col overflow-hidden rounded-xl border border-wa-divider md:h-[calc(100dvh-7.5rem)]">
      <header className="flex items-center justify-between gap-3 border-b border-wa-divider bg-wa-panel px-4 py-2.5 text-wa-panel-foreground">
        <div>
          <h1 className="text-base font-semibold">Chat</h1>
          <p className="text-xs text-wa-meta">WhatsApp conectado via Zernio</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/settings/integrations")}>
            <Plug className="mr-2 h-4 w-4" />
            Integração
          </Button>
          <Button size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Sincronizar
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(300px,360px)_1fr]">
        <div className={active ? "hidden min-h-0 overflow-hidden md:block" : "block min-h-0 overflow-hidden"}>
          {loadingConvs ? (
            <div className="p-4 text-sm text-muted-foreground">Carregando conversas…</div>
          ) : (
            <ConversationList
              conversations={filtered}
              activeId={conversationId ?? null}
              search={search}
              onSearchChange={setSearch}
              onSelect={(c) => navigate(`/chat/${c.zernio_conversation_id}`)}
              avatarFor={avatarFor}
            />
          )}
        </div>

        <div className="flex min-h-0 flex-col">
          {!active ? (
            <div className="wa-wallpaper flex flex-1 flex-col items-center justify-center gap-3 border-b-4 border-wa-accent p-8 text-center">
              <MessageSquare className="h-16 w-16 text-wa-meta" strokeWidth={1} />
              <h2 className="text-xl font-light text-wa-panel-foreground">Sua caixa de entrada</h2>
              <p className="max-w-md text-sm text-wa-meta">
                Selecione uma conversa à esquerda para ver as mensagens e responder pelo WhatsApp.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-wa-divider bg-wa-panel px-3 py-2 text-wa-panel-foreground">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  onClick={() => navigate("/chat")}
                  aria-label="Voltar"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <WaAvatar name={conversationTitle(active)} src={avatarFor(active)} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{conversationTitle(active)}</p>
                  <p className="truncate text-xs text-wa-meta">{formatPhone(active.phone)}</p>
                </div>
                {active.patient_id && <Badge variant="secondary">Paciente</Badge>}
                {!active.patient_id && active.contact_id && <Badge variant="secondary">Contato</Badge>}
                <Badge variant={windowOpen ? "default" : "outline"}>
                  {windowOpen ? "Janela 24h aberta" : "Janela 24h fechada"}
                </Badge>
              </div>

              <MessageList messages={messages} loading={loadingMsgs} />

              <MessageComposer
                conversationKey={active.id}
                disabled={!windowOpen}
                blockedReason={
                  windowOpen
                    ? null
                    : "A janela de 24 horas do WhatsApp está fechada. Aguarde uma nova mensagem do contato para responder livremente."
                }
                onSend={handleSend}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
