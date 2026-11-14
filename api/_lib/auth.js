import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client with the service role (bypasses RLS).
export function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export function bearerToken(req) {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// Verifies the caller's Supabase access token. Returns the user or null.
export async function getUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// The household's active ElevenLabs key from the vault, if any.
export async function getElevenLabsKey(userId) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: hh } = await supabase
    .from('user_households')
    .select('household_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (!hh?.household_id) return null;

  const { data: conn } = await supabase
    .from('connections')
    .select('access_token')
    .eq('household_id', hh.household_id)
    .eq('provider_name', 'elevenlabs')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  return conn?.access_token || null;
}
