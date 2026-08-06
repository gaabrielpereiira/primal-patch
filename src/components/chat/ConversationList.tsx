import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { WaAvatar } from "./WaAvatar";
import { conversationTitle, formatTime, type WaConversation } from "./types";

interface Props {
  conversations: WaConversation[];
  activeId: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (conversation: WaConversation) => void;
  avatarFor: (conversation: WaConversation) => string | null;
}

export function ConversationList({
  conversations,
  activeId,
  search,
  onSearchChange,
  onSelect,
  avatarFor,
}: Props) {
  return (
    <div className="flex h-full w-full flex-col border-r border-wa-divider bg-wa-panel text-wa-panel-foreground">
      <div className="p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-meta" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Pesquisar ou começar uma nova conversa"
            className="h-9 rounded-lg border-0 bg-wa-wallpaper pl-9 text-sm focus-visible:ring-1"
            aria-label="Pesquisar conversa"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        {conversations.length === 0 ? (
          <p className="px-4 py-6 text-sm text-wa-meta">Nenhuma conversa encontrada.</p>
        ) : (
          <ul>
            {conversations.map((c) => {
              const active = c.zernio_conversation_id === activeId;
              const title = conversationTitle(c);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 text-left transition-colors hover:bg-wa-wallpaper/70",
                      active && "bg-wa-wallpaper",
                    )}
                  >
                    <WaAvatar name={title} src={avatarFor(c)} />
                    <div className="min-w-0 flex-1 border-b border-wa-divider py-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] font-medium">{title}</span>
                        <span
                          className={cn(
                            "shrink-0 text-[11px]",
                            c.unread_count > 0 ? "text-wa-accent" : "text-wa-meta",
                          )}
                        >
                          {formatTime(c.last_message_at)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] text-wa-meta">
                          {c.last_message_preview || "—"}
                        </span>
                        {c.unread_count > 0 && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-wa-accent px-1.5 text-[11px] font-medium text-wa-accent-foreground">
                            {c.unread_count}
                          </span>
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
