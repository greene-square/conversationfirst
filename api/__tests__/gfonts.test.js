// Unit tests for api/gfonts.js (Node-style (req, res) Google Fonts metadata proxy).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler from '../gfonts.js'
import { jsonResponse, mockFetch, makeNodeRes } from './helpers.js'

describe('api/gfonts', () => {
  let fetchMock

  beforeEach(() => {
    fetchMock = mockFetch(async () => jsonResponse({ familyMetadataList: [{ family: 'Inter' }] }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('proxies Google Fonts metadata with a 24h cache header', async () => {
    const res = makeNodeRes()
    await handler({ method: 'GET' }, res)
    expect(fetchMock).toHaveBeenCalledWith('https://fonts.google.com/metadata/fonts')
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=86400, s-maxage=86400')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ familyMetadataList: [{ family: 'Inter' }] })
  })

  it('returns 502 when the upstream fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND'))
    const res = makeNodeRes()
    await handler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'Failed to fetch Google Fonts metadata' })
    expect(res.setHeader).not.toHaveBeenCalled()
  })

  it('returns 502 when the upstream body is not JSON (e.g. an XSSI-prefixed payload)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(")]}'\n{\"a\":1}", { status: 200 }))
    const res = makeNodeRes()
    await handler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(502)
  })

  it('only answers GET', async () => {
    const res = makeNodeRes()
    await handler({ method: 'DELETE' }, res)
    expect(res.statusCode).toBe(405)
    expect(res.headers['allow']).toBe('GET')
  })

  // Fixed: `response.ok` is never checked. If Google returns an error status
  // with a JSON body (e.g. 429 {"error":...}), the proxy responds 200 and sets
  // a 24h public/CDN cache header, so the error is cached for a day.
  it('an upstream non-2xx should not be returned as a cacheable 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429))
    const res = makeNodeRes()
    await handler({ method: 'GET' }, res)
    expect(res.statusCode).toBe(502)
    expect(res.headers['cache-control']).toBeUndefined()
  })
})
