// Fixed-window rate limiting.
//
// With UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN set, counts are
// shared across all edge instances. Without them, each instance keeps its own
// counts in memory: weaker, but still caps a single client hammering one
// region. If Upstash is unreachable we fall back to memory rather than block
// legitimate traffic.

const memory = new Map();

export async function rateLimit(key, { limit, windowMs }) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      const res = await fetch(`${url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          ['INCR', key],
          ['PEXPIRE', key, String(windowMs), 'NX'],
          ['PTTL', key],
        ]),
      });
      if (res.ok) {
        const [incr, , ttl] = await res.json();
        const count = Number(incr?.result);
        const ttlMs = Math.max(Number(ttl?.result) || 0, 0);
        if (Number.isFinite(count)) {
          return { ok: count <= limit, retryAfter: Math.ceil(ttlMs / 1000) };
        }
      }
    } catch {
      // fall through to the in-memory limiter
    }
  }
  return memoryLimit(key, limit, windowMs);
}

function memoryLimit(key, limit, windowMs) {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    if (memory.size > 10_000) prune(now);
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: limit >= 1, retryAfter: Math.ceil(windowMs / 1000) };
  }
  entry.count += 1;
  return { ok: entry.count <= limit, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
}

function prune(now) {
  for (const [key, entry] of memory) {
    if (entry.resetAt <= now) memory.delete(key);
  }
}

// Tests only: clear in-memory counts between cases.
export function resetRateLimits() {
  memory.clear();
}
