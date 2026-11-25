import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

export const CHAT_BUCKET = 'chat-images';

let supabaseAdmin = null;

export function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return null;
    }
    supabaseAdmin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseAdmin;
}

export async function uploadChatImage(dataUrl) {
  const match = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) {
    return { error: 'Only PNG, JPEG, WEBP, or GIF images are allowed.' };
  }
  const mimeType = match[1].toLowerCase();
  const ext = match[2].toLowerCase() === 'jpeg' ? 'jpg' : match[2].toLowerCase();
  const buf = Buffer.from(match[3], 'base64');
  if (buf.length > 5 * 1024 * 1024) {
    return { error: 'Image exceeds the 5 MB size limit.' };
  }

  const client = getSupabaseAdmin();
  if (!client) {
    return { error: 'Supabase Storage is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).' };
  }

  const objectPath = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage
    .from(CHAT_BUCKET)
    .upload(objectPath, buf, { contentType: mimeType, upsert: false });

  if (error) {
    return { error: `Storage upload failed: ${error.message}` };
  }
  return { path: objectPath };
}

export async function signChatImageUrl(pathOrUrl) {
  if (!pathOrUrl) return '';
  if (pathOrUrl.startsWith('http') || pathOrUrl.startsWith('/uploads/') || pathOrUrl.startsWith('data:')) {
    return pathOrUrl;
  }
  const client = getSupabaseAdmin();
  if (!client) return '';
  const { data, error } = await client.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(pathOrUrl, 3600);
  if (error || !data?.signedUrl) return '';
  return data.signedUrl;
}
