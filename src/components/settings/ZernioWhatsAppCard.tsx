import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Eye, EyeOff, ExternalLink, Loader2, Plus, RefreshCw, MessageCircle, Trash2 } from "lucide-react";

interface ZernioProfile { id: string; name: string }
interface ZernioNumber { id: string; display: string; name: string }
interface ZernioAccount {
  id: string; name: string; phone: string; status: string; coexistence: boolean | null;
}

type ErrorPayload = { error?: string; message?: string | null; dashboard_url?: string | null };

function errorMessage(data: ErrorPayload): string {
  switch (data.error) {
    case "invalid_key":
      return "API Key inválida ou expirada. Gere uma nova em Zernio → Settings → API Keys.";
    case "missing_api_key":
      return "Informe a API Key da Zernio.";
    case "payment_required":
      return data.message || "A Zernio pediu um método de pagamento para conectar mais contas.";
    case "forbidden":
      return data.message || "Sem permissão para este perfil na Zernio.";
    case "not_found":
      return data.message || "Perfil ou conta não encontrado na Zernio.";
    case "unreachable":
      return "Não foi possível contatar a Zernio. Tente novamente em instantes.";
    default:
      return data.message || "Falha ao comunicar com a Zernio.";
  }
}

export function ZernioWhatsAppCard({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [verified, setVerified] = useState(false);
  const [profiles, setProfiles] = useState<ZernioProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [numbers, setNumbers] = useState<ZernioNumber[]>([]);

  const call = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      if (!orgId) throw new Error("Organização não identificada");
      const { data, error } = await supabase.functions.invoke("zernio-connect", {
        body: { action, org_id: orgId, ...payload },
      });
      if (error) throw error;
      return data as any;
    },
    [orgId],
  );

  const fetchCfg = useCallback(async () => {
    if (!orgId) {
      setCfg(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    const { data } = await (supabase as any)
      .from("integration_configs")
      .select("*")
      .eq("org_id", orgId)
      .eq("provider", "zernio_whatsapp")
      .maybeSingle();
    setCfg(data || null);
    setLoading(false);
    return data;
  }, [orgId]);

  useEffect(() => { void fetchCfg(); }, [fetchCfg]);

  const refreshAccounts = useCallback(async (silent = false) => {
    setBusy("refresh");
    try {
      const data = await call("list_accounts");
      if (data?.error) {
        if (!silent) toast({ title: "Erro", description: errorMessage(data), variant: "destructive" });
        return;
      }
      const accounts = (data?.accounts ?? []) as ZernioAccount[];
      await fetchCfg();
      if (!silent) {
        toast({
          title: accounts.length ? "Status atualizado" : "Nenhum número conectado",
          description: accounts.length ? `${accounts[0].phone || accounts[0].name}` : "Conclua a autorização na Zernio.",
        });
      }
    } catch (e: any) {
      if (!silent) toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }, [call, fetchCfg, toast]);

  // Retorno do OAuth: ?connected=whatsapp
  useEffect(() => {
    if (!orgId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") !== "whatsapp") return;
    params.delete("connected");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    toast({ title: "Autorização concluída", description: "Buscando o número conectado…" });
    void refreshAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const openDialog = async () => {
    setApiKey("");
    setNewProfileName("");
    setNumbers([]);
    setProfileId(cfg?.config?.profile_id || "");
    setVerified(!!cfg?.config?.verified_at);
    setOpen(true);
    if (cfg?.config?.verified_at) void loadProfiles();
  };

  const loadProfiles = async (key?: string) => {
    setBusy("profiles");
    try {
      const data = await call("list_profiles", key ? { api_key: key } : {});
      if (data?.error) {
        toast({ title: "Erro", description: errorMessage(data), variant: "destructive" });
        return;
      }
      setProfiles((data?.profiles ?? []) as ZernioProfile[]);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    setBusy("verify");
    try {
      const data = await call("verify", { api_key: apiKey.trim() || undefined });
      if (data?.error || !data?.valid) {
        toast({ title: "Falha na validação", description: errorMessage(data ?? {}), variant: "destructive" });
        return;
      }
      setVerified(true);
      toast({ title: "API Key válida", description: "Chave salva com segurança." });
      await fetchCfg();
      await loadProfiles();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const createProfile = async () => {
    if (!newProfileName.trim()) return;
    setBusy("create_profile");
    try {
      const data = await call("create_profile", { profile_name: newProfileName.trim() });
      if (data?.error) {
        toast({ title: "Erro", description: errorMessage(data), variant: "destructive" });
        return;
      }
      const p = data.profile as ZernioProfile;
      setProfiles((prev) => [...prev, p]);
      setProfileId(p.id);
      setNewProfileName("");
      toast({ title: "Perfil criado", description: p.name });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const startConnect = async () => {
    if (!profileId) {
      toast({ title: "Selecione um perfil", variant: "destructive" });
      return;
    }
    setBusy("connect");
    try {
      const redirect = `${window.location.origin}${window.location.pathname}?connected=whatsapp`;
      const data = await call("connect_url", { profile_id: profileId, redirect_url: redirect });
      if (data?.error || !data?.authUrl) {
        toast({ title: "Erro", description: errorMessage(data ?? {}), variant: "destructive" });
        if (data?.dashboard_url) window.open(data.dashboard_url, "_blank", "noopener");
        return;
      }
      await fetchCfg();
      window.open(data.authUrl, "_blank", "noopener");
      toast({
        title: "Autorização aberta em nova aba",
        description: "Conclua o pareamento do número e volte para esta página.",
      });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const loadNumbers = async () => {
    setBusy("numbers");
    try {
      const data = await call("list_phone_numbers", { profile_id: profileId || undefined });
      if (data?.error) {
        toast({ title: "Sem números para escolher", description: errorMessage(data) });
        setNumbers([]);
        return;
      }
      const list = (data?.numbers ?? []) as ZernioNumber[];
      setNumbers(list);
      if (!list.length) toast({ title: "Nenhum número pendente de seleção" });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const selectNumber = async (phoneNumberId: string) => {
    setBusy("select");
    try {
      const data = await call("select_phone_number", {
        profile_id: profileId || undefined,
        phone_number_id: phoneNumberId,
      });
      if (data?.error) {
        toast({ title: "Erro", description: errorMessage(data), variant: "destructive" });
        return;
      }
      toast({ title: "Número vinculado" });
      setNumbers([]);
      await refreshAccounts(true);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      await call("disconnect");
      toast({ title: "Zernio desconectada" });
      setVerified(false);
      setProfiles([]);
      setProfileId("");
      await fetchCfg();
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const connectedPhone = cfg?.config?.phone as string | undefined;
  const isConnected = !!connectedPhone;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <MessageCircle className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm">WhatsApp (Zernio)</CardTitle>
              <CardDescription className="text-[10px]">
                Número oficial, com suporte a coexistência com o app WhatsApp Business
              </CardDescription>
            </div>
          </div>
          {cfg && (
            <Badge variant={isConnected ? "default" : "secondary"} className="text-[9px]">
              {isConnected ? "Conectado" : "Pendente"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : cfg ? (
          <div className="flex items-end justify-between gap-2">
            <div className="text-xs space-y-0.5">
              {cfg.config?.key_last4 && (
                <div>
                  <span className="text-muted-foreground">API Key: </span>
                  <span className="font-mono">sk_••••{cfg.config.key_last4}</span>
                </div>
              )}
              {cfg.config?.profile_id && (
                <div>
                  <span className="text-muted-foreground">Perfil: </span>
                  <span className="font-medium">{cfg.config.profile_name || cfg.config.profile_id}</span>
                </div>
              )}
              {connectedPhone ? (
                <>
                  <div>
                    <span className="text-muted-foreground">Número: </span>
                    <span className="font-medium">{connectedPhone}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status: </span>
                    <span className="font-medium">{cfg.config?.status || "ativo"}</span>
                    {cfg.config?.coexistence ? " · coexistência" : ""}
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground">Nenhum número vinculado ainda.</p>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="outline" size="sm" className="h-7 text-[10px]"
                onClick={() => refreshAccounts()} disabled={busy === "refresh"}
              >
                {busy === "refresh"
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <RefreshCw className="h-3 w-3" />}
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={openDialog}>
                Gerenciar
              </Button>
            </div>
          </div>
        ) : !orgId ? (
          <p className="text-xs text-muted-foreground">
            Organização não identificada. Recarregue a página ou entre novamente para configurar a Zernio.
          </p>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Zernio não configurada.</p>
            <Button size="sm" className="h-7 text-[10px]" onClick={openDialog}>
              <Plus className="mr-1 h-3 w-3" />Conectar
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Conectar WhatsApp via Zernio</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <details className="rounded-lg border border-border bg-muted/50 p-3 text-xs">
              <summary className="cursor-pointer font-medium">Como funciona?</summary>
              <ol className="mt-2 space-y-1 list-decimal list-inside text-muted-foreground">
                <li>Crie uma API Key em Zernio → Settings → API Keys (formato <code>sk_…</code>)</li>
                <li>Valide a chave aqui e escolha (ou crie) um perfil para a clínica</li>
                <li>Clique em “Conectar WhatsApp” e conclua a autorização com a Meta</li>
                <li>Números em coexistência continuam funcionando no app WhatsApp Business</li>
              </ol>
            </details>

            <div className="space-y-1">
              <Label className="text-xs">API Key da Zernio</Label>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setVerified(false); }}
                  placeholder={cfg?.config?.key_last4 ? `Salva (sk_••••${cfg.config.key_last4}) — deixe vazio para manter` : "sk_..."}
                  className="h-8 text-xs pr-9"
                />
                <button
                  type="button" onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button
                size="sm" variant="outline" className="h-7 text-[10px]"
                onClick={verify} disabled={busy === "verify"}
              >
                {busy === "verify"
                  ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Validando…</>
                  : "Validar chave"}
              </Button>
            </div>

            {verified && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Perfil na Zernio</Label>
                  <Select value={profileId} onValueChange={setProfileId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={busy === "profiles" ? "Carregando…" : "Selecione um perfil"} />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-1 pt-1">
                    <Input
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      placeholder="Criar novo perfil…"
                      className="h-8 text-xs"
                    />
                    <Button
                      size="sm" variant="outline" className="h-8 text-[10px]"
                      onClick={createProfile} disabled={busy === "create_profile" || !newProfileName.trim()}
                    >
                      {busy === "create_profile"
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Plus className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="h-8 text-[10px]" onClick={startConnect} disabled={busy === "connect" || !profileId}>
                    {busy === "connect"
                      ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Abrindo…</>
                      : <><ExternalLink className="mr-1 h-3 w-3" />Conectar WhatsApp</>}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-[10px]" onClick={loadNumbers} disabled={busy === "numbers" || !profileId}>
                    {busy === "numbers"
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : "Escolher número"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-[10px]" onClick={() => refreshAccounts()} disabled={busy === "refresh" || !profileId}>
                    {busy === "refresh"
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <><RefreshCw className="mr-1 h-3 w-3" />Atualizar status</>}
                  </Button>
                </div>

                {numbers.length > 0 && (
                  <div className="space-y-1 rounded-lg border border-border p-2">
                    <p className="text-[11px] text-muted-foreground">Escolha o número a vincular:</p>
                    {numbers.map((n) => (
                      <div key={n.id} className="flex items-center justify-between gap-2 text-xs">
                        <span>{n.display} {n.name ? `· ${n.name}` : ""}</span>
                        <Button
                          size="sm" variant="outline" className="h-6 text-[10px]"
                          onClick={() => selectNumber(n.id)} disabled={busy === "select"}
                        >
                          Vincular
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {cfg ? (
              <Button
                variant="ghost" size="sm" className="text-[10px] text-destructive"
                onClick={disconnect} disabled={busy === "disconnect"}
              >
                {busy === "disconnect"
                  ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  : <Trash2 className="mr-1 h-3 w-3" />}
                Desconectar
              </Button>
            ) : <span />}
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
