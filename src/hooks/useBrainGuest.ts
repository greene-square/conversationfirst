import { useCallback, useRef } from 'react';

const STORAGE_KEY = 'cf-brain-memories';
const MAX_MEMORIES = 100;

// Simple stop words to filter out during client-side matching
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'about', 'like', 'through', 'after', 'over', 'between',
  'out', 'against', 'during', 'without', 'before', 'under', 'around',
  'among', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both',
  'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
  'too', 'very', 'just', 'because', 'if', 'when', 'where', 'how', 'what',
  'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'i', 'me',
  'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them',
  'his', 'her', 'its', 'their', 'up', 'down', 'then', 'there', 'here',
]);

function loadMemories() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveMemories(memories) {
  // Prune to max
  const trimmed = memories.slice(0, MAX_MEMORIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  return trimmed;
}

// Extract search words from a string (remove stop words, lowercase, dedupe)
function extractWords(text) {
  return [...new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  )];
}

/**
 * Brain hook for guest (non-authenticated) users.
 * Uses localStorage for memory storage.
 * Calls the API for summarization (keyword extraction), but does recall locally.
 */
export function useBrainGuest(accessToken = null) {
  const lastMemoriesRef = useRef([]);

  /**
   * Summarize a conversation turn. Calls API for keyword extraction,
   * then saves to localStorage.
   */
  const summarize = useCallback((conversationId, turnIndex, userMessage, assistantMessage) => {
    const userText = typeof userMessage === 'string'
      ? userMessage
      : Array.isArray(userMessage)
        ? userMessage.filter(b => b.type === 'text').map(b => b.text).join(' ')
        : '';

    const assistantText = typeof assistantMessage === 'string'
      ? assistantMessage
      : '';

    if (!userText.trim() || !assistantText.trim()) return;
    if ((userText + assistantText).trim().length < 50) return;

    // Signed-in users without the database still need a token: summarizing
    // calls a paid model.
    if (!accessToken) return;
    fetch('/api/brain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        action: 'summarize-guest',
        user_message: userText.trim(),
        assistant_message: assistantText.trim().slice(0, 2000),
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.memory) return;

        const memory = {
          id: crypto.randomUUID(),
          conversation_id: conversationId,
          summary: data.memory.summary,
          keywords: data.memory.keywords,
          turn_index: turnIndex,
          created_at: new Date().toISOString(),
        };

        const existing = loadMemories();
        saveMemories([memory, ...existing]);
      })
      .catch(() => {}); // Silently ignore
  }, [accessToken]);

  /**
   * Recall relevant memories using client-side keyword matching.
   * No API call needed. Fast and free.
   */
  const recall = useCallback(async (query) => {
    if (!query || query.trim().length < 5) {
      lastMemoriesRef.current = [];
      return [];
    }

    const searchWords = extractWords(query);
    if (searchWords.length === 0) {
      lastMemoriesRef.current = [];
      return [];
    }

    const all = loadMemories();

    // Score each memory by keyword overlap
    const scored = all.map(m => {
      const overlap = m.keywords.filter(k => searchWords.some(sw =>
        k.includes(sw) || sw.includes(k)
      ));
      return { ...m, score: overlap.length };
    });

    // Filter to memories with at least 1 keyword match, sort by score then recency
    const matches = scored
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
      .map(({ score, ...m }) => ({
        ...m,
        conversation_title: '', // Guest mode doesn't track titles in memories
      }));

    lastMemoriesRef.current = matches;
    return matches;
  }, []);

  return { recall, summarize, lastMemories: lastMemoriesRef };
}
