import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const PHOTO_BUCKET = 'item-photos';

export function getSupabaseConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  };
}

export function createBrowserSupabaseClient(): SupabaseClient | null {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    return null;
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export function usernameToEmail(username: string) {
  const value = username.trim().toLowerCase();
  return value.includes('@') ? value : `${value}@gpf.local`;
}
