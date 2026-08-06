export type WaConversation = {
  id: string;
  org_id: string;
  zernio_conversation_id: string;
  zernio_account_id: string | null;
  phone: string | null;
  display_name: string | null;
  avatar_url: string | null;
  patient_id: string | null;
  contact_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_inbound_at: string | null;
  unread_count: number;
  status: string;
};

export type WaMessage = {
  id: string;
  conversation_id: string;
  zernio_message_id: string | null;
  direction: "inbound" | "outbound";
  body: string | null;
  media_url: string | null;
  media_type: string | null;
  status: string | null;
  sent_at: string;
};

/** WhatsApp only allows freeform replies within 24h of the last inbound message. */
export function isWindowOpen(conversation: WaConversation | null | undefined) {
  if (!conversation?.last_inbound_at) return false;
  const diff = Date.now() - new Date(conversation.last_inbound_at).getTime();
  return diff < 24 * 60 * 60 * 1000;
}

export function formatPhone(phone: string | null) {
  if (!phone) return "";
  const d = phone.replace(/\D+/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return `+${d}`;
}

export function conversationTitle(c: WaConversation) {
  return c.display_name?.trim() || formatPhone(c.phone) || "Sem nome";
}

export function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
