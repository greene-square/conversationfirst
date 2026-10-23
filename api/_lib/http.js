// Shared request/response helpers for the edge API handlers.
// Files under api/_lib are not deployed as endpoints (underscore prefix).

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// Reads a JSON object body, capped at maxChars. Requiring application/json
// means a third-party page can't post here from a visitor's browser without
// a CORS preflight, which these endpoints never answer.
// Returns { body } on success or { error: Response }.
export async function readJsonBody(req, { maxChars }) {
  const type = (req.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('application/json')) {
    return { error: json({ error: 'Content-Type must be application/json' }, 415) };
  }

  const declared = Number(req.headers.get('content-length'));
  if (declared > maxChars * 4) {
    return { error: json({ error: 'Request too large' }, 413) };
  }

  let text;
  try {
    text = await req.text();
  } catch {
    return { error: json({ error: 'Invalid body' }, 400) };
  }
  if (text.length > maxChars) {
    return { error: json({ error: 'Request too large' }, 413) };
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: json({ error: 'Invalid JSON' }, 400) };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: json({ error: 'Invalid JSON' }, 400) };
  }
  return { body };
}

export function clientIp(req) {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

export function tooManyRequests(retryAfter, message) {
  return json({ error: message }, 429, { 'Retry-After': String(Math.max(retryAfter, 1)) });
}
