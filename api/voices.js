import { json, clientIp, tooManyRequests } from './_lib/http.js';
import { bearerToken, getUser, getElevenLabsKey } from './_lib/auth.js';
import { rateLimit } from './_lib/rateLimit.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const user = bearerToken(req) ? await getUser(req) : null;

  const limited = await rateLimit(user ? `voices:user:${user.id}` : `voices:ip:${clientIp(req)}`, { limit: 30, windowMs: 10 * 60_000 });
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfter, 'Too many requests. Try again in a few minutes.');
  }

  // Signed-in users see their own vault key's voices; guests see the site
  // key's stock voices only, never cloned or custom ones.
  const siteKey = process.env.ELEVENLABS_API_KEY || null;
  const apiKey = user ? (await getElevenLabsKey(user.id)) || siteKey : siteKey;
  if (!apiKey) {
    if (!user) return json({ error: 'Unauthorized' }, 401);
    return json({ error: 'No ElevenLabs API key configured.' }, 404);
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });

    if (!response.ok) {
      return json({ error: 'Failed to fetch voices from ElevenLabs.' }, 502);
    }

    const data = await response.json();
    const voices = (data.voices || [])
      .map(v => ({
        id: v.voice_id,
        name: v.name,
        category: v.category || 'custom',
        previewUrl: v.preview_url || null,
      }))
      .filter(v => user || v.category === 'premade');

    return json({ voices });
  } catch {
    return json({ error: 'Failed to reach ElevenLabs.' }, 502);
  }
}
