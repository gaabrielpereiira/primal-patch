import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2 } from "lucide-react";

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
      <div className="border-t border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        {blockedReason}
      </div>
    );
  }

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2">
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
          placeholder="Escreva uma mensagem…"
          className="max-h-40 min-h-[44px] resize-none"
          disabled={disabled || sending}
          aria-label="Mensagem"
        />
        <Button
          size="icon"
          onClick={() => void submit()}
          disabled={disabled || sending || !text.trim()}
          aria-label="Enviar mensagem"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
