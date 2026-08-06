import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { conversationTitle, formatTime, type WaConversation } from "./types";

interface Props {
  conversations: WaConversation[];
  activeId: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (conversation: WaConversation) => void;
}

export function ConversationList({ conversations, activeId, search, onSearchChange, onSelect }: Props) {
  return (
    <div className="flex h-full w-full flex-col border-r border-border">
      <div className="p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar conversa"
            className="pl-9"
            aria-label="Buscar conversa"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        {conversations.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nenhuma conversa encontrada.</p>
        ) : (
          <ul className="pb-4">
            {conversations.map((c) => {
              const active = c.zernio_conversation_id === activeId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60",
                      active && "bg-muted",
                    )}
                  >
                    <Avatar className="h-10 w-10 shrink-0">
                      {c.avatar_url ? <AvatarImage src={c.avatar_url} alt="" /> : null}
                      <AvatarFallback>{conversationTitle(c).slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{conversationTitle(c)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatTime(c.last_message_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">
                          {c.last_message_preview || "—"}
                        </span>
                        {c.unread_count > 0 && (
                          <Badge className="h-5 min-w-5 justify-center px-1.5 text-[11px]">
                            {c.unread_count}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
