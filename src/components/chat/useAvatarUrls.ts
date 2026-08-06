import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { WaConversation } from "./types";

const BUCKET = "whatsapp-avatars";

/**
 * Profile pictures live in a private bucket (their WhatsApp CDN URLs expire),
 * so we resolve storage paths into short-lived signed URLs.
 */
export function useAvatarUrls(conversations: WaConversation[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  const paths = conversations
    .map((c) => c.avatar_url)
    .filter((v): v is string => !!v && !/^https?:\/\//i.test(v))
    .sort()
    .join("|");

  useEffect(() => {
    const list = paths ? paths.split("|") : [];
    if (!list.length) return;
    let cancelled = false;

    void supabase.storage
      .from(BUCKET)
      .createSignedUrls(list, 60 * 60)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setUrls((prev) => {
          const next = { ...prev };
          data.forEach((item) => {
            if (item.path && item.signedUrl) next[item.path] = item.signedUrl;
          });
          return next;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [paths]);

  return (conversation: WaConversation | null | undefined) => {
    const raw = conversation?.avatar_url;
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    return urls[raw] ?? null;
  };
}
