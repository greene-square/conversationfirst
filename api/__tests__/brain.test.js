// Unit tests for api/brain.js (memory summarize / recall edge handler).
// See helpers.js for why this runs in the default (jsdom) environment.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSupabaseMock, callArgs, methods } from '../../src/lib/__tests__/helpers/supabaseMock'
import { makeReq, jsonResponse, mockFetch, sentBody, readJson } from './helpers.js'

const sb = createSupabaseMock()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => sb),
}))

import { createClient } from '@supabase/supabase-js'
import handler, { config } from '../brain.js'
import { resetRateLimits } from '../_lib/rateLimit.js'

const USER = { id: 'user-1', email: 'u@test' }
const AUTH = { authorization: 'Bearer good-token' }

/** Anthropic Messages API (non-streaming) response with the given text. */
function haiku(text) {
  return jsonResponse({ content: [{ type: 'text', text }] })
}

const LONG_USER = 'Tell me about the quarterly roadmap for Project Falcon please.'
const LONG_ASSISTANT = 'The Falcon roadmap has three milestones: beta in March, GA in June.'

describe('api/brain', () => {
  let fetchMock

  beforeEach(() => {
    resetRateLimits()
    sb.reset()
    vi.mocked(createClient).mockClear()
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test')
    vi.stubEnv('SUPABASE_URL', 'https://db.test')
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role')
    sb.auth.getUser.mockImplementation(async (token) =>
      token === 'good-token'
        ? { data: { user: USER }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT' } }
    )
    fetchMock = mockFetch(async () => haiku('{"summary":"S","keywords":["a","b","c"]}'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('declares the edge runtime', () => {
    expect(config).toEqual({ runtime: 'edge' })
  })

  describe('request guards', () => {
    it.each(['GET', 'PUT', 'DELETE'])('rejects %s with 405', async (method) => {
      const res = await handler(makeReq(method === 'GET' ? undefined : {}, { method }))
      expect(res.status).toBe(405)
    })

    it('returns 400 for invalid JSON', async () => {
      const res = await handler(makeReq('nope'))
      expect(res.status).toBe(400)
      expect(await readJson(res)).toEqual({ error: 'Invalid JSON' })
    })

    it('returns 401 for authenticated actions without a bearer token', async () => {
      const res = await handler(makeReq({ action: 'recall', query: 'hello world' }))
      expect(res.status).toBe(401)
      expect(await readJson(res)).toEqual({ error: 'Unauthorized' })
      expect(sb.auth.getUser).not.toHaveBeenCalled()
    })

    it('returns 401 when the token is rejected by Supabase', async () => {
      const res = await handler(makeReq({ action: 'recall', query: 'hello world' }, { headers: { authorization: 'Bearer bad' } }))
      expect(res.status).toBe(401)
      expect(sb.auth.getUser).toHaveBeenCalledWith('bad')
    })

    it('returns 401 when the server has no Supabase service credentials', async () => {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
      const res = await handler(makeReq({ action: 'recall', query: 'hello world' }, { headers: AUTH }))
      expect(res.status).toBe(401)
      expect(createClient).not.toHaveBeenCalled()
    })

    it('falls back to VITE_SUPABASE_URL when SUPABASE_URL is unset', async () => {
      vi.stubEnv('SUPABASE_URL', '')
      vi.stubEnv('VITE_SUPABASE_URL', 'https://vite.test')
      await handler(makeReq({ action: 'unknown' }, { headers: AUTH }))
      expect(createClient).toHaveBeenCalledWith('https://vite.test', 'service-role')
    })

    it('returns 400 for an unknown action once authenticated', async () => {
      const res = await handler(makeReq({ action: 'drop-tables' }, { headers: AUTH }))
      expect(res.status).toBe(400)
      expect(await readJson(res)).toEqual({ error: 'Unknown action' })
    })

    // Fixed: `const { action } = body` throws a TypeError for a literal JSON
    // `null` body (valid JSON), producing an opaque 500 instead of a 400.
    it('a JSON body of `null` should return 400, not throw', async () => {
      const res = await handler(makeReq('null'))
      expect(res.status).toBe(400)
    })
  })

  describe('action: summarize-guest (signed in, saved locally)', () => {
    it('requires authentication because it calls a paid model', async () => {
      const res = await handler(makeReq({ action: 'summarize-guest', user_message: LONG_USER, assistant_message: LONG_ASSISTANT }))
      expect(res.status).toBe(401)
      expect(fetchMock).not.toHaveBeenCalled()
      const ok = await handler(makeReq({ action: 'summarize-guest', user_message: LONG_USER, assistant_message: LONG_ASSISTANT }, { headers: AUTH }))
      expect(ok.status).toBe(200)
    })

    it.each([
      ['user_message', { assistant_message: LONG_ASSISTANT }],
      ['assistant_message', { user_message: LONG_USER }],
    ])('returns 400 when %s is missing', async (_f, fields) => {
      const res = await handler(makeReq({ action: 'summarize-guest', ...fields }, { headers: AUTH }))
      expect(res.status).toBe(400)
      expect(await readJson(res)).toEqual({ error: 'Missing fields' })
    })

    it('skips trivial exchanges under 50 characters without calling the model', async () => {
      const res = await handler(makeReq({ action: 'summarize-guest', user_message: 'hi', assistant_message: 'hello' }, { headers: AUTH }))
      expect(await readJson(res)).toEqual({ ok: true, skipped: true })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('calls Haiku with a fixed model and small max_tokens', async () => {
      await handler(makeReq({ action: 'summarize-guest', user_message: LONG_USER, assistant_message: LONG_ASSISTANT }, { headers: AUTH }))
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.anthropic.com/v1/messages')
      expect(init.headers['x-api-key']).toBe('sk-test')
      const body = sentBody(fetchMock)
      expect(body.model).toBe('claude-haiku-4-5')
      expect(body.max_tokens).toBe(512)
      expect(body.system).toMatch(/Return JSON only/)
      expect(body.messages).toEqual([
        { role: 'user', content: `User said: ${LONG_USER}\n\nAssistant replied: ${LONG_ASSISTANT}` },
      ])
    })

    it('extracts JSON wrapped in a markdown fence and normalises keywords', async () => {
      fetchMock.mockResolvedValueOnce(haiku('Here you go:\n```json\n{"summary":"Falcon roadmap","keywords":["  Falcon ", "ROADMAP", 42, "", null, "beta"]}\n```'))
      const res = await handler(makeReq({ action: 'summarize-guest', user_message: LONG_USER, assistant_message: LONG_ASSISTANT }, { headers: AUTH }))
      expect(await readJson(res)).toEqual({
        ok: true,
        memory: { summary: 'Falcon roadmap', keywords: ['falcon', 'roadmap', 'beta'] },
      })
    })

    it.each([
      ['upstream non-200', () => jsonResponse({ error: 'x' }, 500)],
      ['no text content', () => jsonResponse({ content: [] })],
      ['text without JSON', () => haiku('I cannot help with that')],
      ['malformed JSON', () => haiku('{"summary": "x", keywords: }')],
      ['JSON missing keywords', () => haiku('{"summary":"x"}')],
      ['JSON missing summary', () => haiku('{"keywords":["a"]}')],
    ])('returns 500 "Summarization failed" when Haiku gives %s', async (_l, make) => {
      fetchMock.mockResolvedValueOnce(make())
      const res = await handler(makeReq({ action: 'summarize-guest', user_message: LONG_USER, assistant_message: LONG_ASSISTANT }, { headers: AUTH }))
      expect(res.status).toBe(500)
      expect(await readJson(res)).toEqual({ ok: false, error: 'Summarization failed' })
    })

    it('returns 500 without calling upstream when ANTHROPIC_API_KEY is missing', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', '')
      const res = await handler(makeReq({ action: 'summarize-guest', user_message: LONG_USER, assistant_message: LONG_ASSISTANT }, { headers: AUTH }))
      expect(res.status).toBe(500)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    // Fixed (was a security bug): summarize-guest is unauthenticated and has no server-side
    // size cap (the 2000-char cap on assistant_message exists only in the
    // browser hook, and user_message is never capped). Anyone can POST
    // arbitrarily large text to be processed by Haiku on the owner's key.
    it('unauthenticated summarize-guest should reject oversized input', async () => {
      const res = await handler(makeReq({ action: 'summarize-guest', user_message: 'x'.repeat(1_000_000), assistant_message: LONG_ASSISTANT }))
      expect(fetchMock).not.toHaveBeenCalled()
      expect([400, 413]).toContain(res.status)
    })

    // Fixed: if Haiku returns `keywords` as a non-array (e.g. a comma string),
    // `.filter` throws and the handler rejects with an opaque 500.
    it('non-array keywords from the model should be handled gracefully', async () => {
      fetchMock.mockResolvedValueOnce(haiku('{"summary":"x","keywords":"a, b, c"}'))
      const res = await handler(makeReq({ action: 'summarize-guest', user_message: LONG_USER, assistant_message: LONG_ASSISTANT }, { headers: AUTH }))
      expect(res.status).toBeLessThan(600)
    })
  })

  describe('action: summarize (authenticated)', () => {
    const base = { action: 'summarize', conversation_id: 'conv-1', turn_index: 0, user_message: LONG_USER, assistant_message: LONG_ASSISTANT }

    it.each(['conversation_id', 'turn_index', 'user_message', 'assistant_message'])(
      'returns 400 when %s is missing',
      async (field) => {
        const body = { ...base }
        delete body[field]
        const res = await handler(makeReq(body, { headers: AUTH }))
        expect(res.status).toBe(400)
      }
    )

    it('accepts turn_index 0 (uses == null check, not falsy)', async () => {
      const res = await handler(makeReq(base, { headers: AUTH }))
      expect(res.status).toBe(200)
    })

    it('inserts the memory for the token user, ignoring any user_id in the body', async () => {
      fetchMock.mockResolvedValueOnce(haiku('{"summary":"Falcon has 3 milestones","keywords":["Falcon","Roadmap"]}'))
      const res = await handler(makeReq({ ...base, turn_index: 3, user_id: 'attacker' }, { headers: AUTH }))
      expect(await readJson(res)).toEqual({ ok: true })
      const [insert] = sb.queriesFor('memories')
      expect(callArgs(insert, 'insert')[0][0]).toEqual({
        user_id: 'user-1',
        conversation_id: 'conv-1',
        summary: 'Falcon has 3 milestones',
        keywords: ['falcon', 'roadmap'],
        turn_index: 3,
      })
    })

    it('skips trivial turns', async () => {
      const res = await handler(makeReq({ ...base, user_message: 'hi', assistant_message: 'hey' }, { headers: AUTH }))
      expect(await readJson(res)).toEqual({ ok: true, skipped: true })
      expect(sb.queriesFor('memories')).toHaveLength(0)
    })

    it('returns 500 when summarization fails', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, 529))
      const res = await handler(makeReq(base, { headers: AUTH }))
      expect(res.status).toBe(500)
      expect(sb.queriesFor('memories')).toHaveLength(0)
    })

    it('returns 500 without leaking the database error when the insert fails', async () => {
      sb.queue('memories', { data: null, error: { message: 'violates foreign key' } })
      const res = await handler(makeReq(base, { headers: AUTH }))
      expect(res.status).toBe(500)
      expect(await readJson(res)).toEqual({ ok: false, error: 'Could not save memory' })
    })

    it('the "no DB" guest fallback inside summarize is unreachable: without Supabase creds auth fails first', async () => {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
      const res = await handler(makeReq(base, { headers: AUTH }))
      expect(res.status).toBe(401)
    })
  })

  describe('action: recall (authenticated)', () => {
    function memRow(i, extra = {}) {
      return {
        id: `m${i}`,
        summary: `summary ${i}`,
        conversation_id: `c${i}`,
        keywords: ['falcon'],
        created_at: `2026-01-${String(10 + i).padStart(2, '0')}T00:00:00Z`,
        conversations: { title: `Title ${i}` },
        ...extra,
      }
    }

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['too short', ' ab '],
    ])('returns no memories without calling the model when query is %s', async (_l, query) => {
      const res = await handler(makeReq({ action: 'recall', query }, { headers: AUTH }))
      expect(await readJson(res)).toEqual({ memories: [] })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns no memories when keyword extraction fails or is empty', async () => {
      fetchMock.mockResolvedValueOnce(haiku('{"keywords":[]}'))
      const res = await handler(makeReq({ action: 'recall', query: 'what about falcon' }, { headers: AUTH }))
      expect(await readJson(res)).toEqual({ memories: [] })
      expect(sb.queriesFor('memories')).toHaveLength(0)
    })

    it('builds a user-scoped keyword-overlap query and maps rows', async () => {
      fetchMock.mockResolvedValueOnce(haiku('{"keywords":["Falcon"," Roadmap ",""]}'))
      sb.queue('memories', { data: [memRow(1), memRow(2, { conversations: null })], error: null })
      const res = await handler(makeReq({ action: 'recall', query: 'what about falcon' }, { headers: AUTH }))
      const json = await readJson(res)

      const [q] = sb.queriesFor('memories')
      expect(methods(q)).toEqual(['select', 'eq', 'overlaps', 'order', 'limit'])
      expect(callArgs(q, 'select')[0][0]).toContain('conversations(title)')
      expect(callArgs(q, 'eq')[0]).toEqual(['user_id', 'user-1'])
      expect(callArgs(q, 'overlaps')[0]).toEqual(['keywords', ['falcon', 'roadmap']])
      expect(callArgs(q, 'order')[0]).toEqual(['created_at', { ascending: false }])
      expect(callArgs(q, 'limit')[0]).toEqual([10])

      expect(json.memories).toEqual([
        { id: 'm1', summary: 'summary 1', conversation_id: 'c1', conversation_title: 'Title 1', keywords: ['falcon'], created_at: '2026-01-11T00:00:00Z' },
        { id: 'm2', summary: 'summary 2', conversation_id: 'c2', conversation_title: '', keywords: ['falcon'], created_at: '2026-01-12T00:00:00Z' },
      ])
      // Only one model call when <= 5 results (no re-rank)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('returns no memories on DB error', async () => {
      fetchMock.mockResolvedValueOnce(haiku('{"keywords":["falcon"]}'))
      sb.queue('memories', { data: null, error: { message: 'boom' } })
      const res = await handler(makeReq({ action: 'recall', query: 'what about falcon' }, { headers: AUTH }))
      expect(await readJson(res)).toEqual({ memories: [] })
    })

    it('re-ranks with Haiku when more than 5 memories match, keeping the top 5 valid indices', async () => {
      fetchMock
        .mockResolvedValueOnce(haiku('{"keywords":["falcon"]}'))
        .mockResolvedValueOnce(haiku('{"indices":[6, 99, -1, "2", 0, 5, 1, 3, 4]}'))
      sb.queue('memories', { data: Array.from({ length: 7 }, (_, i) => memRow(i)), error: null })
      const res = await handler(makeReq({ action: 'recall', query: 'what about falcon' }, { headers: AUTH }))
      const { memories } = await readJson(res)
      expect(memories.map(m => m.id)).toEqual(['m6', 'm0', 'm5', 'm1', 'm3'])
      const rerankPrompt = sentBody(fetchMock, 1).messages[0].content
      expect(rerankPrompt).toContain('Query: what about falcon')
      expect(rerankPrompt).toContain('[6] summary 6')
    })

    it('keeps the DB order when re-ranking fails or yields no valid indices', async () => {
      fetchMock
        .mockResolvedValueOnce(haiku('{"keywords":["falcon"]}'))
        .mockResolvedValueOnce(haiku('{"indices":[100, 200]}'))
      sb.queue('memories', { data: Array.from({ length: 6 }, (_, i) => memRow(i)), error: null })
      const res = await handler(makeReq({ action: 'recall', query: 'what about falcon' }, { headers: AUTH }))
      expect((await readJson(res)).memories).toHaveLength(6)
    })

    // Fixed: re-rank indices are not de-duplicated, so a model reply such as
    // {"indices":[0,0,0,0,0]} returns the same memory five times, which is
    // then injected five times into the chat system prompt.
    it('duplicate re-rank indices should not produce duplicate memories', async () => {
      fetchMock
        .mockResolvedValueOnce(haiku('{"keywords":["falcon"]}'))
        .mockResolvedValueOnce(haiku('{"indices":[0,0,0,1,1]}'))
      sb.queue('memories', { data: Array.from({ length: 6 }, (_, i) => memRow(i)), error: null })
      const res = await handler(makeReq({ action: 'recall', query: 'what about falcon' }, { headers: AUTH }))
      const ids = (await readJson(res)).memories.map(m => m.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    // Fixed: `query.trim()` assumes a string. A numeric/object query throws a
    // TypeError and the handler rejects (opaque 500) instead of returning [].
    it('a non-string query should be rejected gracefully', async () => {
      const res = await handler(makeReq({ action: 'recall', query: 12345 }, { headers: AUTH }))
      expect(res.status).toBeLessThan(500)
    })
  })
})
