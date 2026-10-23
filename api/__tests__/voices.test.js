// Unit tests for api/voices.js (ElevenLabs voice list edge handler).
// See helpers.js for why this runs in the default (jsdom) environment.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSupabaseMock, callArgs } from '../../src/lib/__tests__/helpers/supabaseMock'
import { makeReq, jsonResponse, mockFetch, readJson } from './helpers.js'

const sb = createSupabaseMock()
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => sb) }))

import handler, { config } from '../voices.js'
import { resetRateLimits } from '../_lib/rateLimit.js'

const AUTH = { authorization: 'Bearer good-token' }
const get = (headers = {}) => makeReq(undefined, { method: 'GET', headers })

describe('api/voices', () => {
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
    fetchMock = mockFetch(async () => jsonResponse({ voices: [] }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('declares the edge runtime', () => {
    expect(config).toEqual({ runtime: 'edge' })
  })

  it.each(['POST', 'PUT', 'DELETE'])('rejects %s with 405', async (method) => {
    const res = await handler(makeReq({}, { method }))
    expect(res.status).toBe(405)
  })

  it('shows guests only the site key\'s stock voices, in a simplified shape', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      voices: [
        { voice_id: 'v1', name: 'Rachel', category: 'premade', preview_url: 'https://p/1.mp3', labels: { secret: 1 } },
        { voice_id: 'v2', name: 'Mine' },
      ],
    }))
    const res = await handler(get())
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': 'el-env-key' } })
    expect(await readJson(res)).toEqual({
      voices: [
        { id: 'v1', name: 'Rachel', category: 'premade', previewUrl: 'https://p/1.mp3' },
      ],
    })
  })

  it('shows signed-in users every voice on their key', async () => {
    sb.queue('user_households', { data: null, error: null })
    fetchMock.mockResolvedValueOnce(jsonResponse({
      voices: [
        { voice_id: 'v1', name: 'Rachel', category: 'premade' },
        { voice_id: 'v2', name: 'Mine' },
      ],
    }))
    const res = await handler(get(AUTH))
    expect((await readJson(res)).voices.map(v => v.id)).toEqual(['v1', 'v2'])
  })

  it('returns an empty list when the upstream payload has no voices array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const res = await handler(get())
    expect(await readJson(res)).toEqual({ voices: [] })
  })

  it('returns 502 when upstream responds non-200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'invalid key acct-123' }, 401))
    const res = await handler(get())
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'Failed to fetch voices from ElevenLabs.' })
    expect(text).not.toContain('acct-123')
  })

  it('returns 502 when upstream is unreachable or returns invalid JSON', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect((await handler(get())).status).toBe(502)
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }))
    const res = await handler(get())
    expect(res.status).toBe(502)
    expect(await readJson(res)).toEqual({ error: 'Failed to reach ElevenLabs.' })
  })

  describe('without an env key (vault mode)', () => {
    beforeEach(() => vi.stubEnv('ELEVENLABS_API_KEY', ''))

    it('returns 401 without a token', async () => {
      const res = await handler(get())
      expect(res.status).toBe(401)
    })

    it('returns 401 for an invalid token', async () => {
      const res = await handler(get({ authorization: 'Bearer nope' }))
      expect(res.status).toBe(401)
      expect(sb.auth.getUser).toHaveBeenCalledWith('nope')
    })

    it('returns 404 when no vault key exists', async () => {
      sb.queue('user_households', { data: { household_id: 'hh-1' }, error: null })
      sb.queue('connections', { data: { access_token: null }, error: null })
      const res = await handler(get(AUTH))
      expect(res.status).toBe(404)
    })

    it('uses the household ElevenLabs connection token', async () => {
      sb.queue('user_households', { data: { household_id: 'hh-9' }, error: null })
      sb.queue('connections', { data: { access_token: 'vault-key' }, error: null })
      const res = await handler(get(AUTH))
      expect(res.status).toBe(200)
      expect(fetchMock.mock.calls[0][1].headers['xi-api-key']).toBe('vault-key')
      expect(callArgs(sb.queriesFor('connections')[0], 'eq')).toContainEqual(['household_id', 'hh-9'])
    })
  })
})
