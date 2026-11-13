import { createClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'edge',
};

// Server-side Supabase client with service role (bypasses RLS for inserts)
function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// Validate access token and return user
async function getUser(req) {
  const supabase = getSupabase();
  if (!supabase) return null;
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// Call Claude Haiku for lightweight tasks (summarization, keyword extraction)
async function callHaiku(system, userContent) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-5-5',
      // Thinking counts toward max_tokens; low effort usually skips it
      max_tokens: 2048,
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    console.error('Anthropic API error', response.status, await response.text().catch(() => ''));
    return null;
  }

  const data = await response.json();
  // A response can start with a thinking block, so find the text by type
  const text = data.content?.find(b => b.type === 'text')?.text;
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
    `User said: ${user_message}\n\nAssistant replied: ${assistant_message}`
  );

  if (!result || !result.summary || !result.keywords) {
    return new Response(JSON.stringify({ ok: false, error: 'Summarization failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Ensure keywords are lowercase strings
  const keywords = result.keywords
    .filter(k => typeof k === 'string')
    .map(k => k.toLowerCase().trim())
    .filter(k => k.length > 0);

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
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
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
    query
  );

  if (!extracted || !extracted.keywords || extracted.keywords.length === 0) {
    return new Response(JSON.stringify({ memories: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const searchKeywords = extracted.keywords
    .filter(k => typeof k === 'string')
    .map(k => k.toLowerCase().trim())
    .filter(k => k.length > 0);

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
      const ranked = rankResult.indices
        .filter(i => typeof i === 'number' && i >= 0 && i < memories.length)
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

// ─── Action: summarize-guest (no DB save, returns result) ─
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
    `User said: ${user_message}\n\nAssistant replied: ${assistant_message}`
  );

  if (!result || !result.summary || !result.keywords) {
    return new Response(JSON.stringify({ ok: false, error: 'Summarization failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const keywords = result.keywords
    .filter(k => typeof k === 'string')
    .map(k => k.toLowerCase().trim())
    .filter(k => k.length > 0);

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

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { action } = body;

  // Guest summarization doesn't need auth
  if (action === 'summarize-guest') {
    return handleSummarizeGuest(body);
  }

  // All other actions require authentication
  const user = await getUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  switch (action) {
    case 'summarize':
      return handleSummarize(body, user.id);
    case 'recall':
      return handleRecall(body, user.id);
    default:
      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
  }
}
