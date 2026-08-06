import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, CheckCheck, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { type WaMessage } from "./types";

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "HOJE";
  if (d.toDateString() === yesterday.toDateString()) return "ONTEM";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function StatusIcon({ status }: { status: string | null }) {
  const s = (status ?? "").toLowerCase();
  if (s === "read") return <CheckCheck className="h-3.5 w-3.5 text-wa-accent" />;
  if (s === "delivered") return <CheckCheck className="h-3.5 w-3.5" />;
  if (s === "sent") return <Check className="h-3.5 w-3.5" />;
  return <Clock className="h-3 w-3" />;
}

export function MessageList({ messages, loading }: { messages: WaMessage[]; loading: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (loading) {
    return <div className="wa-wallpaper flex-1 p-6 text-sm text-wa-meta">Carregando mensagens…</div>;
  }

  if (messages.length === 0) {
    return (
      <div className="wa-wallpaper flex flex-1 items-center justify-center p-6 text-sm text-wa-meta">
        Nenhuma mensagem nesta conversa ainda.
      </div>
    );
  }

  let lastDay = "";

  return (
    <ScrollArea className="wa-wallpaper flex-1">
      <div className="flex flex-col gap-1.5 px-4 py-4 md:px-12">
        {messages.map((m) => {
          const day = dayLabel(m.sent_at);
          const showDay = day !== lastDay;
          lastDay = day;
          const mine = m.direction === "outbound";
          return (
            <div key={m.id} className="flex flex-col gap-1.5">
              {showDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-lg bg-wa-panel px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-wa-meta shadow-sm">
                    {day}
                  </span>
                </div>
              )}
              <div className={cn("flex", mine ? "justify-end pr-2" : "justify-start pl-2")}>
                <div
                  className={cn(
                    "relative max-w-[75%] rounded-lg px-2.5 py-1.5 text-[14.5px] leading-snug text-wa-bubble-foreground shadow-sm",
                    mine ? "wa-bubble-out bg-wa-bubble-out" : "wa-bubble-in bg-wa-bubble-in",
                  )}
                >
                  {m.media_url && (
                    <a
                      href={m.media_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mb-1 block underline underline-offset-2"
                    >
                      {m.media_type ? `Anexo (${m.media_type})` : "Anexo"}
                    </a>
                  )}
                  {m.body && (
                    <p className="whitespace-pre-wrap break-words pr-14">{m.body}</p>
                  )}
                  <span className="float-right -mt-3 ml-2 flex items-center gap-1 text-[10.5px] text-wa-meta">
                    {timeLabel(m.sent_at)}
                    {mine && <StatusIcon status={m.status} />}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
