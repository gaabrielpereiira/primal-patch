import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { type WaMessage } from "./types";

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function MessageList({ messages, loading }: { messages: WaMessage[]; loading: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (loading) {
    return <div className="flex-1 p-6 text-sm text-muted-foreground">Carregando mensagens…</div>;
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Nenhuma mensagem nesta conversa ainda.
      </div>
    );
  }

  let lastDay = "";

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-2 p-4">
        {messages.map((m) => {
          const day = dayLabel(m.sent_at);
          const showDay = day !== lastDay;
          lastDay = day;
          const mine = m.direction === "outbound";
          return (
            <div key={m.id} className="flex flex-col gap-2">
              {showDay && (
                <div className="my-2 flex justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
                    {day}
                  </span>
                </div>
              )}
              <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                    mine
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm bg-muted text-foreground",
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
                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  <div
                    className={cn(
                      "mt-1 text-right text-[10px]",
                      mine ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {timeLabel(m.sent_at)}
                    {mine && m.status ? ` · ${m.status}` : ""}
                  </div>
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
