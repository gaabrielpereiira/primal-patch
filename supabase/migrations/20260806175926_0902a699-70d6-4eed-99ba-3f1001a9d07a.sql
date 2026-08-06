CREATE TABLE public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  zernio_conversation_id text NOT NULL,
  zernio_account_id text,
  phone text,
  display_name text,
  avatar_url text,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  last_message_at timestamptz,
  last_message_preview text,
  last_inbound_at timestamptz,
  unread_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, zernio_conversation_id)
);

CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  zernio_message_id text,
  direction text NOT NULL,
  body text,
  media_url text,
  media_type text,
  status text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, zernio_message_id)
);

CREATE TABLE public.zernio_webhook_events (
  event_id text PRIMARY KEY,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_conv_org_last ON public.whatsapp_conversations (org_id, last_message_at DESC NULLS LAST);
CREATE INDEX idx_wa_msg_conv ON public.whatsapp_messages (conversation_id, sent_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_conversations TO authenticated;
GRANT ALL ON public.whatsapp_conversations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;
GRANT ALL ON public.zernio_webhook_events TO service_role;

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zernio_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage wa conversations"
ON public.whatsapp_conversations FOR ALL TO authenticated
USING (org_id = public.current_org_id())
WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "org members manage wa messages"
ON public.whatsapp_messages FOR ALL TO authenticated
USING (org_id = public.current_org_id())
WITH CHECK (org_id = public.current_org_id());

CREATE TRIGGER trg_wa_conversations_touch
BEFORE UPDATE ON public.whatsapp_conversations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
ALTER TABLE public.whatsapp_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_messages REPLICA IDENTITY FULL;