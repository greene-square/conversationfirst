import { json, readJsonBody, clientIp, tooManyRequests } from './_lib/http.js';
import { bearerToken, getUser, getElevenLabsKey } from './_lib/auth.js';
import { rateLimit } from './_lib/rateLimit.js';

export const config = {
  runtime: 'edge',
};

const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // Rachel, an ElevenLabs stock voice
const VOICE_ID = /^[A-Za-z0-9]{10,64}$/;
const TIERS = {
  guest: { maxText: 2_500, rate: { limit: 10, windowMs: 10 * 60_000 } },
  user: { maxText: 10_000, rate: { limit: 60, windowMs: 10 * 60_000 } },
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const user = bearerToken(req) ? await getUser(req) : null;
  const tier = user ? TIERS.user : TIERS.guest;

  const limited = await rateLimit(user ? `tts:user:${user.id}` : `tts:ip:${clientIp(req)}`, tier.rate);
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfter, 'Too many read-aloud requests. Try again in a few minutes.');
  }

  const { body, error } = await readJsonBody(req, { maxChars: tier.maxText * 2 + 1_000 });
  if (error) return error;

  const { text, voiceId } = body;
  if (!text || typeof text !== 'string') {
    return json({ error: 'text field required' }, 400);
  }
  if (text.length > tier.maxText) {
    return json({ error: 'This message is too long to read aloud.' }, 413);
  }
  if (voiceId !== undefined && voiceId !== null && (typeof voiceId !== 'string' || !VOICE_ID.test(voiceId))) {
    return json({ error: 'Invalid voice.' }, 400);
  }

  // Signed-in users use their own vault key, falling back to the site key.
  // Guests can only use the site key (demo mode), if one is configured.
  const siteKey = process.env.ELEVENLABS_API_KEY || null;
  const apiKey = user ? (await getElevenLabsKey(user.id)) || siteKey : siteKey;
  if (!apiKey) {
    if (!user) return json({ error: 'Unauthorized' }, 401);
    return json({ error: 'No ElevenLabs API key configured.' }, 404);
  }

  const voice = voiceId || DEFAULT_VOICE;
  // On the site key, guests are limited to stock voices so nobody can
  // synthesise speech with a cloned voice on the account.
  if (!user && voice !== DEFAULT_VOICE && !(await isStockVoice(voice, apiKey))) {
    return json({ error: 'That voice is only available when signed in.' }, 403);
  }

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      let message = 'ElevenLabs synthesis failed.';
      if (status === 401) message = 'ElevenLabs API key is invalid. Update it in the Vault.';
      else if (status === 429) message = 'ElevenLabs rate limit reached. Try again shortly.';
      else if (status === 422) message = 'Text too long or invalid for synthesis.';
      return json({ error: message }, 502);
    }

    const audio = toBase64(new Uint8Array(await response.arrayBuffer()));
    return json({ audio });
  } catch {
    return json({ error: 'Failed to reach ElevenLabs.' }, 502);
  }
}

const stockVoiceCache = new Map();

async function isStockVoice(voiceId, apiKey) {
  if (stockVoiceCache.has(voiceId)) return stockVoiceCache.get(voiceId);
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, {
      headers: { 'xi-api-key': apiKey },
    });
    const stock = res.ok && (await res.json())?.category === 'premade';
    stockVoiceCache.set(voiceId, stock);
    return stock;
  } catch {
    return false;
  }
}

// Chunked to avoid building the string one character at a time.
function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
