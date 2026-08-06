import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PROVIDER,
  WEBHOOK_SECRET_NAME,
  digits,
  hmacSha256Hex,
  phoneCandidates,
  timingSafeEqual,
} from "../_shared/zernio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-zernio-signature, x-zernio-event-id",
};

function ok(payload: Record<string, unknown> = { ok: true }) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Method not allowed");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return fail(500, "Server configuration error");

  const token = new URL(req.url).searchParams.get("t");
  if (!token) return fail(401, "Missing token");

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: cfgRow } = await admin
    .from("integration_configs")
    .select("org_id, config")
    .eq("provider", PROVIDER)
    .eq("config->>webhook_token", token)
    .maybeSingle();

  if (!cfgRow) return fail(401, "Unknown token");
  const orgId = cfgRow.org_id as string;

  const rawBody = await req.text();

  const { data: secretRow } = await admin
    .from("org_secrets")
    .select("key_value")
    .eq("org_id", orgId)
    .eq("key_name", WEBHOOK_SECRET_NAME)
    .maybeSingle();

  const secret = secretRow?.key_value as string | undefined;
  if (secret) {
    const provided = req.headers.get("x-zernio-signature") ?? req.headers.get("x-late-signature");
    if (!provided) return fail(401, "Missing signature");
    const expected = await hmacSha256Hex(secret, rawBody);
    if (!timingSafeEqual(expected, provided.trim().toLowerCase())) return fail(401, "Bad signature");
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return fail(400, "Invalid JSON");
  }

  const eventId: string =
    req.headers.get("x-zernio-event-id") ?? event?.id ?? crypto.randomUUID();
  const eventType: string = event?.event ?? "unknown";

  // Deduplicate (at-least-once delivery)
  const { error: dedupeErr } = await admin
    .from("zernio_webhook_events")
    .insert({ event_id: eventId, org_id: orgId, event_type: eventType });
  if (dedupeErr) {
    if (dedupeErr.code === "23505") return ok({ ok: true, duplicate: true });
    console.error("dedupe insert failed", dedupeErr);
  }

  try {
    await handleEvent(admin, orgId, eventType, event);
  } catch (e) {
    console.error("zernio-webhook handler error", eventType, e);
  }

  return ok();
});

async function findLink(admin: any, orgId: string, phone: string) {
  const cands = phoneCandidates(phone);
  if (!cands.length) return { patient_id: null, contact_id: null };

  const suffix = cands.reduce((a, b) => (a.length >= b.length ? a : b)).slice(-8);

  const { data: patients } = await admin
    .from("patients")
    .select("id, phone")
    .eq("org_id", orgId)
    .ilike("phone", `%${suffix}%`)
    .limit(20);
  const patient = (patients ?? []).find((p: any) => cands.includes(digits(p.phone)));

  const { data: contacts } = await admin
    .from("contacts")
    .select("id, phone")
    .eq("org_id", orgId)
    .ilike("phone", `%${suffix}%`)
    .limit(20);
  const contact = (contacts ?? []).find((c: any) => cands.includes(digits(c.phone)));

  return { patient_id: patient?.id ?? null, contact_id: contact?.id ?? null };
}

async function upsertConversation(
  admin: any,
  orgId: string,
  params: {
    conversationId: string;
    accountId: string | null;
    phone: string | null;
    name: string | null;
    avatar: string | null;
  },
) {
  const { data: existing } = await admin
    .from("whatsapp_conversations")
    .select("id, patient_id, contact_id, phone")
    .eq("org_id", orgId)
    .eq("zernio_conversation_id", params.conversationId)
    .maybeSingle();

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (params.name) patch.display_name = params.name;
    if (params.phone && !existing.phone) patch.phone = params.phone;
    if (params.accountId) patch.zernio_account_id = params.accountId;
    if (!existing.patient_id && !existing.contact_id) {
      const link = await findLink(admin, orgId, params.phone ?? existing.phone ?? "");
      Object.assign(patch, link);
    }
    if (params.avatar) {
      const path = await cacheAvatar(admin, orgId, existing.id, params.avatar);
      if (path) patch.avatar_url = path;
    }
    if (Object.keys(patch).length) {
      await admin.from("whatsapp_conversations").update(patch).eq("id", existing.id);
    }
    return existing.id as string;
  }

  const link = await findLink(admin, orgId, params.phone ?? "");
  const { data: inserted, error } = await admin
    .from("whatsapp_conversations")
    .insert({
      org_id: orgId,
      zernio_conversation_id: params.conversationId,
      zernio_account_id: params.accountId,
      phone: params.phone,
      display_name: params.name,
      ...link,
    })
    .select("id")
    .single();
  if (error) throw new Error(`conversation_insert_failed: ${error.message}`);

  if (params.avatar) {
    const path = await cacheAvatar(admin, orgId, inserted.id, params.avatar);
    if (path) await admin.from("whatsapp_conversations").update({ avatar_url: path }).eq("id", inserted.id);
  }
  return inserted.id as string;
}


function extractMessage(event: any) {
  const m = event?.message ?? {};
  const sender = m.sender ?? {};
  const attachment = Array.isArray(m.attachments) ? m.attachments[0] : null;
  const direction = (m.direction ?? "").toLowerCase() === "outgoing" ? "outbound" : "inbound";
  return {
    id: m.id ?? m._id ?? null,
    conversationId: m.conversationId ?? event?.conversation?.id ?? null,
    accountId: event?.account?.id ?? m.accountId ?? null,
    text: m.text ?? m.message ?? "",
    direction,
    senderName: sender.name ?? sender.username ?? event?.conversation?.participantName ?? null,
    senderPhone:
      sender.phone ?? sender.username ?? sender.id ?? event?.conversation?.participantId ?? null,
    avatar: sender.picture ?? event?.conversation?.participantPicture ?? null,
    mediaUrl: attachment?.url ?? null,
    mediaType: attachment?.type ?? null,
    createdAt: m.createdAt ?? m.timestamp ?? new Date().toISOString(),
    status: m.deliveryStatus ?? null,
  };
}

async function handleEvent(admin: any, orgId: string, type: string, event: any) {
  if (type === "message.received" || type === "message.sent" || type === "conversation.started") {
    const m = extractMessage(event);
    if (!m.conversationId) return;

    const phone = m.direction === "inbound" ? digits(m.senderPhone) : digits(event?.conversation?.participantId);

    const conversationId = await upsertConversation(admin, orgId, {
      conversationId: m.conversationId,
      accountId: m.accountId,
      phone: phone || null,
      name: m.direction === "inbound" ? m.senderName : event?.conversation?.participantName ?? null,
      avatar: m.avatar,
    });

    if (type === "conversation.started" && !m.id) return;

    if (m.id) {
      const { error } = await admin.from("whatsapp_messages").upsert(
        {
          org_id: orgId,
          conversation_id: conversationId,
          zernio_message_id: m.id,
          direction: m.direction,
          body: m.text,
          media_url: m.mediaUrl,
          media_type: m.mediaType,
          status: m.status ?? (m.direction === "outbound" ? "sent" : null),
          sent_at: m.createdAt,
          raw: event,
        },
        { onConflict: "org_id,zernio_message_id" },
      );
      if (error) console.error("message upsert failed", error);
    }

    const patch: Record<string, unknown> = {
      last_message_at: m.createdAt,
      last_message_preview: (m.text || (m.mediaType ? `[${m.mediaType}]` : "")).slice(0, 200),
    };
    if (m.direction === "inbound") {
      patch.last_inbound_at = m.createdAt;
      const { data: conv } = await admin
        .from("whatsapp_conversations")
        .select("unread_count")
        .eq("id", conversationId)
        .maybeSingle();
      patch.unread_count = (conv?.unread_count ?? 0) + 1;
    }
    await admin.from("whatsapp_conversations").update(patch).eq("id", conversationId);
    return;
  }

  if (["message.delivered", "message.read", "message.failed", "message.deleted"].includes(type)) {
    const m = extractMessage(event);
    if (!m.id) return;
    const status = type.split(".")[1];
    await admin
      .from("whatsapp_messages")
      .update({ status })
      .eq("org_id", orgId)
      .eq("zernio_message_id", m.id);
    return;
  }

  if (type === "account.connected" || type === "account.disconnected") {
    const { data } = await admin
      .from("integration_configs")
      .select("config")
      .eq("org_id", orgId)
      .eq("provider", PROVIDER)
      .maybeSingle();
    const config = { ...(data?.config ?? {}), status: type === "account.connected" ? "active" : "disconnected" };
    await admin
      .from("integration_configs")
      .update({ config, is_active: type === "account.connected" })
      .eq("org_id", orgId)
      .eq("provider", PROVIDER);
  }
}
