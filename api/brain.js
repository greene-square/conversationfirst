import { json, readJsonBody, tooManyRequests } from './_lib/http.js';
import { getSupabase, getUser } from './_lib/auth.js';
import { rateLimit } from './_lib/rateLimit.js';

export const config = {
  runtime: 'edge',
};

const MAX_TURN_CHARS = 8_000;

// Model replies sometimes return keywords as a comma string; accept both.
function toKeywords(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return list
    .filter(k => typeof k === 'string')
    .map(k => k.toLowerCase().trim())
    .filter(k => k.length > 0);
}

// Call Claude Haiku for lightweight tasks (summarization, keyword extraction)
async function callHaiku(system, userContent) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        system,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) return null;

  // Extract JSON from response (may be wrapped in markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

// ─── Action: summarize ────────────────────────────────────
async function handleSummarize(body, userId) {
  const { conversation_id, turn_index, user_message, assistant_message } = body;

  if (!conversation_id || turn_index == null || !user_message || !assistant_message) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Skip trivial exchanges
  const combined = (user_message + assistant_message).trim();
  if (combined.length < 50) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await callHaiku(
    `Extract a concise summary and keywords from this conversation turn.
Return JSON only: {"summary": "1-3 sentences capturing the key information exchanged", "keywords": ["lowercase", "words"]}
Keywords should include: topic names, people names, company names, actions taken, key concepts, dates mentioned.
Maximum 10 keywords. Minimum 3 keywords.`,
    `User said: ${String(user_message).slice(0, MAX_TURN_CHARS)}\n\nAssistant replied: ${String(assistant_message).slice(0, MAX_TURN_CHARS)}`
  );

  if (!result || !result.summary || !result.keywords) {
    return new Response(JSON.stringify({ ok: false, error: 'Summarization failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const keywords = toKeywords(result.keywords);

  const supabase = getSupabase();
  if (!supabase) {
    // No DB — return the result so guest mode can save locally
    return new Response(JSON.stringify({
      ok: true,
      memory: { summary: result.summary, keywords },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { error } = await supabase.from('memories').insert({
    user_id: userId,
    conversation_id,
    summary: result.summary,
    keywords,
    turn_index,
  });

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: 'Could not save memory' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Action: recall ───────────────────────────────────────
async function handleRecall(body, userId) {
  const { query } = body;

  if (query !== undefined && query !== null && typeof query !== 'string') {
    return new Response(JSON.stringify({ error: 'query must be a string' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!query || query.trim().length < 3) {
    return new Response(JSON.stringify({ memories: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Extract search keywords from query
  const extracted = await callHaiku(
    `Extract 3-5 search keywords from this user query that would help find relevant past conversations.
Return JSON only: {"keywords": ["lowercase", "words"]}
Focus on: names, topics, companies, specific concepts. Exclude generic words like "what", "how", "the".`,
    query.slice(0, MAX_TURN_CHARS)
  );

  if (!extracted || toKeywords(extracted.keywords).length === 0) {
    return new Response(JSON.stringify({ memories: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const searchKeywords = toKeywords(extracted.keywords);

  const supabase = getSupabase();
  if (!supabase) {
    return new Response(JSON.stringify({ memories: [], keywords: searchKeywords }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Query memories with array overlap (&&) — any keyword match
  const { data, error } = await supabase
    .from('memories')
    .select('id, summary, conversation_id, keywords, created_at, conversations(title)')
    .eq('user_id', userId)
    .overlaps('keywords', searchKeywords)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data) {
    return new Response(JSON.stringify({ memories: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let memories = data.map(m => ({
    id: m.id,
    summary: m.summary,
    conversation_id: m.conversation_id,
    conversation_title: m.conversations?.title || '',
    keywords: m.keywords,
    created_at: m.created_at,
  }));

  // If too many results, use Haiku to re-rank by relevance
  if (memories.length > 5) {
    const rankResult = await callHaiku(
      `Given the user's query and these memory summaries, return the indices (0-based) of the 5 most relevant memories.
Return JSON only: {"indices": [0, 2, 4, 1, 3]}`,
      `Query: ${query}\n\nMemories:\n${memories.map((m, i) => `[${i}] ${m.summary}`).join('\n')}`
    );

    if (rankResult?.indices && Array.isArray(rankResult.indices)) {
      const ranked = [...new Set(rankResult.indices)]
        .filter(i => Number.isInteger(i) && i >= 0 && i < memories.length)
        .slice(0, 5)
        .map(i => memories[i]);
      if (ranked.length > 0) {
        memories = ranked;
      }
    }
  }

  return new Response(JSON.stringify({ memories }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Action: summarize-guest (no DB save, returns result for local storage) ─
async function handleSummarizeGuest(body) {
  const { user_message, assistant_message } = body;

  if (!user_message || !assistant_message) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const combined = (user_message + assistant_message).trim();
  if (combined.length < 50) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await callHaiku(
    `Extract a concise summary and keywords from this conversation turn.
Return JSON only: {"summary": "1-3 sentences capturing the key information exchanged", "keywords": ["lowercase", "words"]}
Keywords should include: topic names, people names, company names, actions taken, key concepts.
Maximum 10 keywords. Minimum 3 keywords.`,
    `User said: ${String(user_message).slice(0, MAX_TURN_CHARS)}\n\nAssistant replied: ${String(assistant_message).slice(0, MAX_TURN_CHARS)}`
  );

  if (!result || !result.summary || !result.keywords) {
    return new Response(JSON.stringify({ ok: false, error: 'Summarization failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const keywords = toKeywords(result.keywords);

  return new Response(JSON.stringify({
    ok: true,
    memory: { summary: result.summary, keywords },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Main handler ─────────────────────────────────────────
export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { body, error } = await readJsonBody(req, { maxChars: 64_000 });
  if (error) return error;

  // Every action calls a paid model, so all of them require a signed-in user.
  const user = await getUser(req);
  if (!user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const limited = await rateLimit(`brain:user:${user.id}`, { limit: 120, windowMs: 10 * 60_000 });
  if (!limited.ok) {
    return tooManyRequests(limited.retryAfter, 'Too many requests. Try again in a few minutes.');
  }

  switch (body.action) {
    case 'summarize':
      return handleSummarize(body, user.id);
    case 'summarize-guest':
      return handleSummarizeGuest(body);
    case 'recall':
      return handleRecall(body, user.id);
    default:
      return json({ error: 'Unknown action' }, 400);
  }
}
