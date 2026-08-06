export const ZERNIO_BASE = "https://zernio.com/api/v1";
export const PROVIDER = "zernio_whatsapp";
export const SECRET_NAME = "zernio_api_key";
export const WEBHOOK_SECRET_NAME = "zernio_webhook_secret";

/** Digits-only version of a phone number. */
export function digits(input: string | null | undefined): string {
  return (input ?? "").replace(/\D+/g, "");
}

/**
 * Candidate digit strings for matching a WhatsApp number against stored
 * contacts/patients. Handles the Brazilian 9th-digit variation and the
 * optional 55 country code.
 */
export function phoneCandidates(input: string | null | undefined): string[] {
  const d = digits(input);
  if (!d) return [];
  const out = new Set<string>([d]);

  const local = d.startsWith("55") ? d.slice(2) : d;
  out.add(local);
  out.add(`55${local}`);

  if (local.length === 11 && local[2] === "9") {
    const without9 = local.slice(0, 2) + local.slice(3);
    out.add(without9);
    out.add(`55${without9}`);
  }
  if (local.length === 10) {
    const with9 = `${local.slice(0, 2)}9${local.slice(2)}`;
    out.add(with9);
    out.add(`55${with9}`);
  }
  return [...out].filter((v) => v.length >= 8);
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const AVATAR_BUCKET = "whatsapp-avatars";

/**
 * Downloads a WhatsApp profile picture (its CDN URLs expire) and stores a
 * stable copy in the private `whatsapp-avatars` bucket.
 * Returns the storage object path, or null when nothing could be stored.
 */
export async function cacheAvatar(
  admin: any,
  orgId: string,
  conversationRowId: string,
  sourceUrl: string | null | undefined,
): Promise<string | null> {
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return null;
  try {
    const resp = await fetch(sourceUrl);
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (!bytes.length || bytes.length > 5_000_000) return null;

    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const path = `${orgId}/${conversationRowId}.${ext}`;
    const { error } = await admin.storage
      .from(AVATAR_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

/** Picks the first usable picture URL out of a Zernio payload. */
export function pickPicture(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//i.test(c)) return c;
  }
  return null;
}
