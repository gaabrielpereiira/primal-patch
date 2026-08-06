import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, Smile, Paperclip } from "lucide-react";

interface Props {
  disabled: boolean;
  blockedReason?: string | null;
  onSend: (text: string) => Promise<void>;
  conversationKey: string;
}

export function MessageComposer({ disabled, blockedReason, onSend, conversationKey }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText("");
    if (!disabled) ref.current?.focus();
  }, [conversationKey, disabled]);

  const submit = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await onSend(value);
      setText("");
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  if (blockedReason) {
    return (
      <div className="border-t border-wa-divider bg-wa-panel p-4 text-center text-sm text-wa-meta">
        {blockedReason}
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 border-t border-wa-divider bg-wa-panel px-3 py-2">
      <div className="flex items-center gap-1 pb-1.5 text-wa-meta">
        <button type="button" disabled aria-label="Emojis (em breve)" className="p-1.5 opacity-50">
          <Smile className="h-5 w-5" />
        </button>
        <button type="button" disabled aria-label="Anexar (em breve)" className="p-1.5 opacity-50">
          <Paperclip className="h-5 w-5" />
        </button>
      </div>

      <Textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="Digite uma mensagem"
        rows={1}
        className="max-h-40 min-h-[42px] resize-none rounded-2xl border-0 bg-wa-wallpaper px-4 py-2.5 text-[15px] focus-visible:ring-1"
        disabled={disabled || sending}
        aria-label="Mensagem"
      />

      <button
        type="button"
        onClick={() => void submit()}
        disabled={disabled || sending || !text.trim()}
        aria-label="Enviar mensagem"
        className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wa-accent text-wa-accent-foreground transition-opacity disabled:opacity-40"
      >
        {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
      </button>
    </div>
  );
}
