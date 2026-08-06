import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  WEBHOOK_SECRET_NAME,
  cacheAvatar,
  digits,
  phoneCandidates,
  pickPicture,
} from "../_shared/zernio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ZERNIO_BASE = "https://zernio.com/api/v1";
const PROVIDER = "zernio_whatsapp";
const SECRET_NAME = "zernio_api_key";

const WEBHOOK_EVENTS = [
  "message.received",
  "message.sent",
  "message.delivered",
  "message.read",
  "message.failed",
  "conversation.started",
  "account.connected",
  "account.disconnected",
];

type Action =
  | "verify"
  | "list_profiles"
  | "create_profile"
  | "connect_url"
  | "list_phone_numbers"
  | "select_phone_number"
  | "list_accounts"
  | "disconnect"
  | "webhook_info"
  | "register_webhook"
  | "unregister_webhook"
  | "sync_conversations"
  | "sync_messages"
  | "send_message"
  | "mark_read"
  | "refresh_avatars";

interface Body {
  action?: Action;
  org_id?: string;
  api_key?: string;
  profile_id?: string;
  profile_name?: string;
  account_id?: string;
  phone_number_id?: string;
  redirect_url?: string;
  conversation_id?: string;
  message?: string;
  conversation_ids?: string[];
}


function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function zernio(
  key: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  const resp = await fetch(`${ZERNIO_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: resp.status, ok: resp.ok, body: parsed };
}

function upstreamError(status: number, body: any) {
  if (status === 401) return json(200, { error: "invalid_key", status });
  if (status === 402) {
    return json(200, {
      error: "payment_required",
      status,
      reason: body?.reason ?? null,
      message: body?.error ?? null,
      dashboard_url: body?.dashboard_url ?? null,
    });
  }
  if (status === 403) return json(200, { error: "forbidden", status, message: body?.error ?? null });
  if (status === 404) return json(200, { error: "not_found", status, message: body?.error ?? null });
  return json(200, { error: "upstream_error", status, message: body?.error ?? null, body });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json(500, { error: "Server configuration error" });
    }

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json(401, { error: "Unauthorized" });

    const body = (await req.json()) as Body;
    const action = body.action;
    const orgId = body.org_id;
    if (!action || !orgId) return json(400, { error: "Missing action or org_id" });

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile } = await admin
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.org_id !== orgId) return json(403, { error: "Forbidden" });

    // Resolve API key: provided in this call, or previously stored
    let apiKey = body.api_key?.trim() || "";
    if (!apiKey) {
      const { data: existing } = await admin
        .from("org_secrets")
        .select("key_value")
        .eq("org_id", orgId)
        .eq("key_name", SECRET_NAME)
        .maybeSingle();
      apiKey = existing?.key_value || "";
    }

    const loadConfig = async () => {
      const { data } = await admin
        .from("integration_configs")
        .select("config")
        .eq("org_id", orgId)
        .eq("provider", PROVIDER)
        .maybeSingle();
      return (data?.config ?? {}) as Record<string, any>;
    };

    const saveConfig = async (patch: Record<string, unknown>, isActive = true) => {
      const current = await loadConfig();
      const merged = { ...current, ...patch };
      const { error } = await admin.from("integration_configs").upsert(
        {
          org_id: orgId,
          provider: PROVIDER,
          config: merged,
          connected_by: user.id,
          is_active: isActive,
        },
        { onConflict: "org_id,provider" },
      );
      if (error) throw new Error(`config_save_failed: ${error.message}`);
      return merged;
    };

    if (action === "disconnect") {
      const cfg = await loadConfig();
      // Best-effort remote disconnect of the linked account
      if (apiKey && cfg.account_id) {
        await zernio(apiKey, "DELETE", `/accounts/${cfg.account_id}`).catch(() => null);
      }
      await admin.from("integration_configs").delete().eq("org_id", orgId).eq("provider", PROVIDER);
      await admin.from("org_secrets").delete().eq("org_id", orgId).eq("key_name", SECRET_NAME);
      return json(200, { ok: true });
    }

    if (!apiKey) return json(200, { error: "missing_api_key" });

    if (action === "verify") {
      let res;
      try {
        res = await zernio(apiKey, "GET", "/auth/verify");
      } catch (e) {
        return json(200, { error: "unreachable", detail: String(e) });
      }
      if (!res.ok) return upstreamError(res.status, res.body);
      if (res.body?.valid === false) return json(200, { error: "invalid_key", status: 401 });

      const { error: secretErr } = await admin.from("org_secrets").upsert(
        { org_id: orgId, key_name: SECRET_NAME, key_value: apiKey },
        { onConflict: "org_id,key_name" },
      );
      if (secretErr) return json(500, { error: "secret_save_failed", detail: secretErr.message });

      await saveConfig({
        key_last4: apiKey.slice(-4),
        auth_type: res.body?.authType ?? "api_key",
        verified_at: new Date().toISOString(),
      });

      return json(200, { valid: true, userId: res.body?.userId ?? null, authType: res.body?.authType ?? null });
    }

    if (action === "list_profiles") {
      const res = await zernio(apiKey, "GET", "/profiles");
      if (!res.ok) return upstreamError(res.status, res.body);
      const raw = res.body?.profiles ?? res.body?.data?.profiles ?? res.body?.data ?? res.body ?? [];
      const profiles = (Array.isArray(raw) ? raw : []).map((p: any) => ({
        id: p._id ?? p.id,
        name: p.name ?? "(sem nome)",
      }));
      return json(200, { profiles });
    }

    if (action === "create_profile") {
      const name = body.profile_name?.trim();
      if (!name) return json(400, { error: "missing_profile_name" });
      const res = await zernio(apiKey, "POST", "/profiles", { name });
      if (!res.ok) return upstreamError(res.status, res.body);
      const p = res.body?.profile ?? res.body?.data?.profile ?? res.body?.data ?? res.body;
      const id = p?._id ?? p?.id;
      if (!id) return json(200, { error: "upstream_error", status: res.status, body: res.body });
      await saveConfig({ profile_id: id, profile_name: p?.name ?? name });
      return json(200, { profile: { id, name: p?.name ?? name } });
    }

    if (action === "connect_url") {
      const profileId = body.profile_id?.trim() || (await loadConfig()).profile_id;
      if (!profileId) return json(400, { error: "missing_profile_id" });
      const redirect = body.redirect_url?.trim();
      const qs = new URLSearchParams({ profileId });
      if (redirect) qs.set("redirect_url", redirect);
      const res = await zernio(apiKey, "GET", `/connect/whatsapp?${qs.toString()}`);
      if (!res.ok) return upstreamError(res.status, res.body);
      const authUrl = res.body?.authUrl ?? res.body?.url;
      if (!authUrl) return json(200, { error: "upstream_error", status: res.status, body: res.body });
      await saveConfig({ profile_id: profileId }, false);
      return json(200, { authUrl });
    }

    if (action === "list_phone_numbers") {
      const profileId = body.profile_id?.trim() || (await loadConfig()).profile_id;
      if (!profileId) return json(400, { error: "missing_profile_id" });
      const res = await zernio(
        apiKey,
        "GET",
        `/connect/whatsapp/select-phone-number?profileId=${encodeURIComponent(profileId)}`,
      );
      if (!res.ok) return upstreamError(res.status, res.body);
      const raw = res.body?.phoneNumbers ?? res.body?.data?.phoneNumbers ?? res.body?.data ?? [];
      const numbers = (Array.isArray(raw) ? raw : []).map((n: any) => ({
        id: n.id ?? n._id ?? n.phoneNumberId,
        display: n.displayPhoneNumber ?? n.display_phone_number ?? n.phoneNumber ?? n.number ?? "",
        name: n.verifiedName ?? n.verified_name ?? n.name ?? "",
      }));
      return json(200, { numbers });
    }

    if (action === "select_phone_number") {
      const profileId = body.profile_id?.trim() || (await loadConfig()).profile_id;
      const phoneNumberId = body.phone_number_id?.trim();
      if (!profileId || !phoneNumberId) return json(400, { error: "missing_parameters" });
      const res = await zernio(apiKey, "POST", "/connect/whatsapp/select-phone-number", {
        profileId,
        phoneNumberId,
      });
      if (!res.ok) return upstreamError(res.status, res.body);
      return json(200, { ok: true, body: res.body });
    }

    if (action === "list_accounts") {
      const profileId = body.profile_id?.trim() || (await loadConfig()).profile_id;
      if (!profileId) return json(400, { error: "missing_profile_id" });
      const res = await zernio(
        apiKey,
        "GET",
        `/accounts?profileId=${encodeURIComponent(profileId)}`,
      );
      if (!res.ok) return upstreamError(res.status, res.body);
      const raw = res.body?.accounts ?? res.body?.data?.accounts ?? res.body?.data ?? res.body ?? [];
      const accounts = (Array.isArray(raw) ? raw : [])
        .filter((a: any) => (a.platform ?? "").toLowerCase() === "whatsapp")
        .map((a: any) => ({
          id: a._id ?? a.id,
          name: a.name ?? a.displayName ?? a.username ?? "",
          phone: a.phoneNumber ?? a.displayPhoneNumber ?? a.username ?? "",
          status: a.status ?? (a.isActive === false ? "inactive" : "active"),
          coexistence: a.coexistence ?? a.isCoexistence ?? null,
        }));

      const primary = accounts[0] ?? null;
      await saveConfig(
        {
          profile_id: profileId,
          account_id: primary?.id ?? null,
          account_name: primary?.name ?? null,
          phone: primary?.phone ?? null,
          status: primary?.status ?? null,
          coexistence: primary?.coexistence ?? null,
          checked_at: new Date().toISOString(),
        },
        !!primary,
      );

      return json(200, { accounts });
    }

    // ---------- Inbox / webhook ----------

    const webhookUrl = (tokenValue: string) =>
      `${supabaseUrl}/functions/v1/zernio-webhook?t=${tokenValue}`;

    const ensureWebhookToken = async () => {
      const cfg = await loadConfig();
      if (cfg.webhook_token) return cfg.webhook_token as string;
      const token = crypto.randomUUID().replace(/-/g, "");
      await saveConfig({ webhook_token: token });
      return token;
    };

    if (action === "webhook_info") {
      const cfg = await loadConfig();
      const token = await ensureWebhookToken();
      return json(200, {
        url: webhookUrl(token),
        registered: !!cfg.webhook_id,
        webhook_id: cfg.webhook_id ?? null,
      });
    }

    if (action === "register_webhook") {
      const token = await ensureWebhookToken();
      const cfg = await loadConfig();

      let secret = "";
      const { data: existingSecret } = await admin
        .from("org_secrets")
        .select("key_value")
        .eq("org_id", orgId)
        .eq("key_name", WEBHOOK_SECRET_NAME)
        .maybeSingle();
      secret = existingSecret?.key_value || "";
      if (!secret) {
        secret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        const { error: secErr } = await admin.from("org_secrets").upsert(
          { org_id: orgId, key_name: WEBHOOK_SECRET_NAME, key_value: secret },
          { onConflict: "org_id,key_name" },
        );
        if (secErr) return json(500, { error: "secret_save_failed", detail: secErr.message });
      }

      const payload = {
        name: "CRM Inbox",
        url: webhookUrl(token),
        events: WEBHOOK_EVENTS,
        secret,
        isActive: true,
      };

      const res = cfg.webhook_id
        ? await zernio(apiKey, "PUT", "/webhooks/settings", { _id: cfg.webhook_id, ...payload })
        : await zernio(apiKey, "POST", "/webhooks/settings", payload);

      if (!res.ok) return upstreamError(res.status, res.body);
      const hook = res.body?.webhook ?? res.body?.data ?? res.body;
      const hookId = hook?._id ?? hook?.id ?? cfg.webhook_id ?? null;
      await saveConfig({ webhook_id: hookId, webhook_registered_at: new Date().toISOString() });
      return json(200, { ok: true, webhook_id: hookId, url: webhookUrl(token) });
    }

    if (action === "unregister_webhook") {
      const cfg = await loadConfig();
      if (cfg.webhook_id) {
        await zernio(apiKey, "DELETE", `/webhooks/settings?_id=${encodeURIComponent(cfg.webhook_id)}`)
          .catch(() => null);
      }
      await saveConfig({ webhook_id: null, webhook_registered_at: null });
      return json(200, { ok: true });
    }

    const resolveAccountId = async () => {
      const cfg = await loadConfig();
      return (body.account_id?.trim() || cfg.account_id || "") as string;
    };

    const linkFor = async (phone: string) => {
      const cands = phoneCandidates(phone);
      if (!cands.length) return { patient_id: null, contact_id: null };
      const suffix = cands.reduce((a, b) => (a.length >= b.length ? a : b)).slice(-8);
      const { data: patients } = await admin
        .from("patients").select("id, phone").eq("org_id", orgId).ilike("phone", `%${suffix}%`).limit(20);
      const { data: contacts } = await admin
        .from("contacts").select("id, phone").eq("org_id", orgId).ilike("phone", `%${suffix}%`).limit(20);
      return {
        patient_id: (patients ?? []).find((p: any) => cands.includes(digits(p.phone)))?.id ?? null,
        contact_id: (contacts ?? []).find((c: any) => cands.includes(digits(c.phone)))?.id ?? null,
      };
    };

    if (action === "sync_conversations") {
      const accountId = await resolveAccountId();
      if (!accountId) return json(200, { error: "not_connected" });

      const res = await zernio(
        apiKey,
        "GET",
        `/inbox/conversations?accountId=${encodeURIComponent(accountId)}&platform=whatsapp&limit=50`,
      );
      if (!res.ok) return upstreamError(res.status, res.body);
      const list = res.body?.data ?? res.body?.conversations ?? [];

      let saved = 0;
      for (const c of Array.isArray(list) ? list : []) {
        const phone = digits(c.participantId ?? c.participantName ?? "");
        const link = await linkFor(phone);
        const { data: row, error } = await admin
          .from("whatsapp_conversations")
          .upsert(
            {
              org_id: orgId,
              zernio_conversation_id: c.id,
              zernio_account_id: c.accountId ?? accountId,
              phone: phone || null,
              display_name: c.participantName ?? null,
              last_message_at: c.updatedTime ?? null,
              last_message_preview: (c.lastMessage ?? "").slice(0, 200),
              status: c.status ?? "active",
              ...link,
            },
            { onConflict: "org_id,zernio_conversation_id" },
          )
          .select("id, avatar_url")
          .maybeSingle();
        if (!error) saved++;

        const picture = pickPicture(c.participantPicture, c.picture, c.avatar);
        if (row?.id && picture && !row.avatar_url) {
          const path = await cacheAvatar(admin, orgId, row.id, picture);
          if (path) await admin.from("whatsapp_conversations").update({ avatar_url: path }).eq("id", row.id);
        }
      }
      return json(200, { ok: true, count: saved });
    }

    if (action === "refresh_avatars") {
      const accountId = await resolveAccountId();
      if (!accountId) return json(200, { error: "not_connected" });

      const ids: string[] = Array.isArray(body.conversation_ids) ? body.conversation_ids : [];
      let query = admin
        .from("whatsapp_conversations")
        .select("id, zernio_conversation_id, avatar_url, patient_id, contact_id")
        .eq("org_id", orgId)
        .is("avatar_url", null)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(ids.length ? ids.length : 30);
      if (ids.length) query = query.in("zernio_conversation_id", ids);

      const { data: convs } = await query;
      let updated = 0;

      for (const conv of convs ?? []) {
        let picture: string | null = null;

        const res = await zernio(
          apiKey,
          "GET",
          `/inbox/conversations/${encodeURIComponent(conv.zernio_conversation_id)}/messages?accountId=${encodeURIComponent(accountId)}&limit=10&sortOrder=desc`,
        ).catch(() => null);
        const msgs = res?.body?.messages ?? res?.body?.data ?? [];
        for (const m of Array.isArray(msgs) ? msgs : []) {
          picture = pickPicture(
            m?.sender?.picture,
            m?.sender?.avatar,
            m?.senderPicture,
            m?.participantPicture,
          );
          if (picture) break;
        }

        if (!picture && (conv.patient_id || conv.contact_id)) {
          const table = conv.patient_id ? "patients" : "contacts";
          const { data: person } = await admin
            .from(table)
            .select("avatar_url")
            .eq("id", conv.patient_id ?? conv.contact_id)
            .maybeSingle();
          picture = pickPicture(person?.avatar_url);
        }

        if (!picture) continue;
        const path = await cacheAvatar(admin, orgId, conv.id, picture);
        if (path) {
          await admin.from("whatsapp_conversations").update({ avatar_url: path }).eq("id", conv.id);
          updated++;
        }
      }

      return json(200, { ok: true, updated });
    }


    if (action === "sync_messages") {
      const accountId = await resolveAccountId();
      const conversationId = body.conversation_id?.trim();
      if (!accountId || !conversationId) return json(400, { error: "missing_parameters" });

      const { data: conv } = await admin
        .from("whatsapp_conversations")
        .select("id")
        .eq("org_id", orgId)
        .eq("zernio_conversation_id", conversationId)
        .maybeSingle();
      if (!conv) return json(404, { error: "conversation_not_found" });

      const res = await zernio(
        apiKey,
        "GET",
        `/inbox/conversations/${encodeURIComponent(conversationId)}/messages?accountId=${encodeURIComponent(accountId)}&limit=100&sortOrder=asc`,
      );
      if (!res.ok) return upstreamError(res.status, res.body);
      const messages = res.body?.messages ?? [];

      const rows = (Array.isArray(messages) ? messages : []).map((m: any) => {
        const att = Array.isArray(m.attachments) ? m.attachments[0] : null;
        return {
          org_id: orgId,
          conversation_id: conv.id,
          zernio_message_id: m.id,
          direction: (m.direction ?? "").toLowerCase() === "outgoing" ? "outbound" : "inbound",
          body: m.message ?? m.text ?? "",
          media_url: att?.url ?? null,
          media_type: att?.type ?? null,
          status: m.deliveryStatus ?? null,
          sent_at: m.createdAt ?? new Date().toISOString(),
          raw: m,
        };
      });

      if (rows.length) {
        const { error } = await admin
          .from("whatsapp_messages")
          .upsert(rows, { onConflict: "org_id,zernio_message_id" });
        if (error) return json(500, { error: "save_failed", detail: error.message });
      }
      return json(200, { ok: true, count: rows.length });
    }

    if (action === "send_message") {
      const accountId = await resolveAccountId();
      const conversationId = body.conversation_id?.trim();
      const text = body.message?.trim();
      if (!accountId || !conversationId || !text) return json(400, { error: "missing_parameters" });

      const res = await zernio(
        apiKey,
        "POST",
        `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
        { accountId, message: text },
      );
      if (!res.ok) return upstreamError(res.status, res.body);

      const sent = res.body?.message ?? res.body?.data ?? res.body ?? {};
      const messageId = sent?.id ?? sent?._id ?? null;

      const { data: conv } = await admin
        .from("whatsapp_conversations")
        .select("id")
        .eq("org_id", orgId)
        .eq("zernio_conversation_id", conversationId)
        .maybeSingle();

      if (conv) {
        const sentAt = sent?.createdAt ?? new Date().toISOString();
        await admin.from("whatsapp_messages").upsert(
          {
            org_id: orgId,
            conversation_id: conv.id,
            zernio_message_id: messageId ?? `local-${crypto.randomUUID()}`,
            direction: "outbound",
            body: text,
            status: "sent",
            sent_at: sentAt,
            sent_by: user.id,
            raw: sent ?? {},
          },
          { onConflict: "org_id,zernio_message_id" },
        );
        await admin
          .from("whatsapp_conversations")
          .update({ last_message_at: sentAt, last_message_preview: text.slice(0, 200) })
          .eq("id", conv.id);
      }

      return json(200, { ok: true, message_id: messageId });
    }

    if (action === "mark_read") {
      const accountId = await resolveAccountId();
      const conversationId = body.conversation_id?.trim();
      if (!conversationId) return json(400, { error: "missing_parameters" });

      await admin
        .from("whatsapp_conversations")
        .update({ unread_count: 0 })
        .eq("org_id", orgId)
        .eq("zernio_conversation_id", conversationId);

      if (accountId) {
        await zernio(apiKey, "POST", `/inbox/conversations/${encodeURIComponent(conversationId)}/read`, {
          accountId,
        }).catch(() => null);
      }
      return json(200, { ok: true });
    }

    return json(400, { error: "unknown_action" });

  } catch (err) {
    console.error("zernio-connect error", err);
    return json(500, { error: "Internal error", detail: String(err) });
  }
});
