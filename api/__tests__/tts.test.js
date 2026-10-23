// Unit tests for api/tts.js (ElevenLabs text-to-speech edge handler).
// See helpers.js for why this runs in the default (jsdom) environment.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSupabaseMock, callArgs } from '../../src/lib/__tests__/helpers/supabaseMock'
import { makeReq, jsonResponse, mockFetch, sentBody, readJson } from './helpers.js'

const sb = createSupabaseMock()
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => sb) }))

import handler, { config } from '../tts.js'
import { resetRateLimits } from '../_lib/rateLimit.js'

const AUTH = { authorization: 'Bearer good-token' }

function audioResponse(bytes) {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
}

describe('api/tts', () => {
  let fetchMock

  beforeEach(() => {
    resetRateLimits()
    sb.reset()
    vi.stubEnv('ELEVENLABS_API_KEY', 'el-env-key')
    vi.stubEnv('SUPABASE_URL', 'https://db.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role')
    sb.auth.getUser.mockImplementation(async (token) =>
      token === 'good-token'
        ? { data: { user: { id: 'user-1' } }, error: null }
        : { data: { user: null }, error: { message: 'bad' } }
    )
    fetchMock = mockFetch(async () => audioResponse([1, 2, 3]))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('declares the edge runtime', () => {
    expect(config).toEqual({ runtime: 'edge' })
  })

  describe('validation', () => {
    it.each(['GET', 'PUT'])('rejects %s with 405', async (method) => {
      const res = await handler(makeReq(method === 'GET' ? undefined : { text: 'x' }, { method }))
      expect(res.status).toBe(405)
    })

    it('returns 400 for invalid JSON', async () => {
      const res = await handler(makeReq('{'))
      expect(res.status).toBe(400)
      expect(await readJson(res)).toEqual({ error: 'Invalid JSON' })
    })

    it.each([
      ['missing', {}],
      ['empty', { text: '' }],
      ['a number', { text: 42 }],
      ['an array', { text: ['hi'] }],
    ])('returns 400 when text is %s', async (_l, body) => {
      const res = await handler(makeReq(body))
      expect(res.status).toBe(400)
      expect(await readJson(res)).toEqual({ error: 'text field required' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('key resolution', () => {
    it('uses the ELEVENLABS_API_KEY env var without requiring auth (demo mode)', async () => {
      const res = await handler(makeReq({ text: 'Hello' }))
      expect(res.status).toBe(200)
      expect(sb.auth.getUser).not.toHaveBeenCalled()
      expect(fetchMock.mock.calls[0][1].headers['xi-api-key']).toBe('el-env-key')
    })

    it('requires auth when no env key is set', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', '')
      const res = await handler(makeReq({ text: 'Hello' }))
      expect(res.status).toBe(401)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns 404 when the user has no household', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', '')
      sb.queue('user_households', { data: null, error: null })
      const res = await handler(makeReq({ text: 'Hello' }, { headers: AUTH }))
      expect(res.status).toBe(404)
      expect(await readJson(res)).toEqual({ error: 'No ElevenLabs API key configured.' })
      expect(sb.queriesFor('connections')).toHaveLength(0)
    })

    it('returns 404 when the household has no active ElevenLabs connection', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', '')
      sb.queue('user_households', { data: { household_id: 'hh-1' }, error: null })
      sb.queue('connections', { data: null, error: null })
      const res = await handler(makeReq({ text: 'Hello' }, { headers: AUTH }))
      expect(res.status).toBe(404)
    })

    it('looks up the vault key scoped to the user household, provider and active status', async () => {
      vi.stubEnv('ELEVENLABS_API_KEY', '')
      sb.queue('user_households', { data: { household_id: 'hh-1' }, error: null })
      sb.queue('connections', { data: { access_token: 'vault-key' }, error: null })
      const res = await handler(makeReq({ text: 'Hello' }, { headers: AUTH }))
      expect(res.status).toBe(200)

      const [hh] = sb.queriesFor('user_households')
      expect(callArgs(hh, 'eq')).toEqual([['user_id', 'user-1']])
      expect(callArgs(hh, 'limit')).toEqual([[1]])
      const [conn] = sb.queriesFor('connections')
      expect(callArgs(conn, 'select')).toEqual([['access_token']])
      expect(callArgs(conn, 'eq')).toEqual([
        ['household_id', 'hh-1'],
        ['provider_name', 'elevenlabs'],
        ['status', 'active'],
      ])
      expect(fetchMock.mock.calls[0][1].headers['xi-api-key']).toBe('vault-key')
    })
  })

  describe('synthesis', () => {
    it('uses the default Rachel voice and fixed model settings', async () => {
      await handler(makeReq({ text: 'Hello there' }))
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM')
      expect(init.method).toBe('POST')
      expect(sentBody(fetchMock)).toEqual({
        text: 'Hello there',
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      })
    })

    it('uses a caller-supplied voiceId for signed-in users', async () => {
      sb.queue('user_households', { data: null, error: null })
      await handler(makeReq({ text: 'Hi', voiceId: 'pNInz6obpgDQGcFmaJgB' }, { headers: AUTH }))
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB')
    })

    it('lets guests use stock voices on the site key', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ voice_id: 'pNInz6obpgDQGcFmaJgB', category: 'premade' }))
        .mockResolvedValueOnce(audioResponse([1]))
      const res = await handler(makeReq({ text: 'Hi', voiceId: 'pNInz6obpgDQGcFmaJgB' }))
      expect(res.status).toBe(200)
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.elevenlabs.io/v1/voices/pNInz6obpgDQGcFmaJgB')
      expect(fetchMock.mock.calls[1][0]).toBe('https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB')
    })

    it('blocks guests from cloned or custom voices on the site key', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ voice_id: 'CLONEDvoiceID0000000', category: 'cloned' }))
      const res = await handler(makeReq({ text: 'Hi', voiceId: 'CLONEDvoiceID0000000' }))
      expect(res.status).toBe(403)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('prefers the signed-in user\'s vault key over the site key', async () => {
      sb.queue('user_households', { data: { household_id: 'hh-1' }, error: null })
      sb.queue('connections', { data: { access_token: 'vault-key' }, error: null })
      await handler(makeReq({ text: 'Hi' }, { headers: AUTH }))
      expect(fetchMock.mock.calls[0][1].headers['xi-api-key']).toBe('vault-key')
    })

    it('caps guest text at 2,500 characters and signed-in text at 10,000', async () => {
      expect((await handler(makeReq({ text: 'a'.repeat(2_501) }))).status).toBe(413)
      sb.queue('user_households', { data: null, error: null })
      expect((await handler(makeReq({ text: 'a'.repeat(2_501) }, { headers: AUTH }))).status).toBe(200)
      expect((await handler(makeReq({ text: 'a'.repeat(10_001) }, { headers: AUTH }))).status).toBe(413)
    })

    it('rate limits guests per IP', async () => {
      const headers = { 'x-forwarded-for': '203.0.113.9' }
      for (let i = 0; i < 10; i++) expect((await handler(makeReq({ text: 'Hi' }, { headers }))).status).toBe(200)
      expect((await handler(makeReq({ text: 'Hi' }, { headers }))).status).toBe(429)
    })

    it('returns the audio bytes base64-encoded (all byte values round-trip)', async () => {
      const bytes = Array.from({ length: 256 }, (_, i) => i)
      fetchMock.mockResolvedValueOnce(audioResponse(bytes))
      const res = await handler(makeReq({ text: 'Hi' }))
      expect(res.status).toBe(200)
      const { audio } = await readJson(res)
      const decoded = Array.from(atob(audio), c => c.charCodeAt(0))
      expect(decoded).toEqual(bytes)
    })

    it.each([
      [401, 'ElevenLabs API key is invalid. Update it in the Vault.'],
      [429, 'ElevenLabs rate limit reached. Try again shortly.'],
      [422, 'Text too long or invalid for synthesis.'],
      [500, 'ElevenLabs synthesis failed.'],
      [400, 'ElevenLabs synthesis failed.'],
    ])('maps upstream %i to 502 "%s" without leaking details', async (status, message) => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ detail: { message: 'quota for acct-secret exceeded' } }, status))
      const res = await handler(makeReq({ text: 'Hi' }))
      expect(res.status).toBe(502)
      const text = await res.text()
      expect(JSON.parse(text)).toEqual({ error: message })
      expect(text).not.toContain('acct-secret')
    })

    it('returns 502 when ElevenLabs is unreachable', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
      const res = await handler(makeReq({ text: 'Hi' }))
      expect(res.status).toBe(502)
      expect(await readJson(res)).toEqual({ error: 'Failed to reach ElevenLabs.' })
    })

    // Fixed (was a security bug): voiceId is interpolated into the upstream URL path without
    // validation or encoding. In demo mode (env key, no auth) any caller can
    // send voiceId "../../v1/user" (or "x?foo=bar") and the server will POST to
    // an arbitrary ElevenLabs endpoint with the owner's xi-api-key attached.
    it('voiceId must not be able to escape the /v1/text-to-speech/ path', async () => {
      await handler(makeReq({ text: 'Hi', voiceId: '../../v1/user' }))
      if (fetchMock.mock.calls.length === 0) return // rejected: acceptable
      const pathname = new URL(fetchMock.mock.calls[0][0]).pathname
      expect(pathname.startsWith('/v1/text-to-speech/')).toBe(true)
    })

    // Fixed (was a security bug): no upper bound on `text` length. With the env key the
    // endpoint is unauthenticated, so anyone can burn the owner's ElevenLabs
    // character quota with a single large request.
    it('oversized text should be rejected before calling ElevenLabs', async () => {
      const res = await handler(makeReq({ text: 'a'.repeat(500_000) }))
      expect(fetchMock).not.toHaveBeenCalled()
      expect([400, 413]).toContain(res.status)
    })
  })
})
