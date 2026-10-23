// Shared helpers for API handler unit tests.
//
// NOTE on environment: these handlers are Vercel *edge* handlers
// (`handler(req: Request) => Response`). Ideally these tests would run with
// `// @vitest-environment node`, but the shared setup file
// (src/test/setup.ts) unconditionally touches `Element.prototype`, which
// throws in the node environment. The jsdom environment still exposes Node's
// WHATWG Request/Response/ReadableStream/fetch globals, so the tests run there.
import { vi } from 'vitest'

export function makeReq(body, { method = 'POST', headers = {}, url = 'http://localhost/api/x' } = {}) {
  const init = { method, headers: { 'Content-Type': 'application/json', ...headers } }
  if (method !== 'GET' && method !== 'HEAD' && body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  return new Request(url, init)
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function textResponse(text, status = 200) {
  return new Response(text, { status })
}

/** Install a fetch mock; returns the vi.fn so tests can inspect calls. */
export function mockFetch(impl) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}

/** Parse the JSON body that was sent with the Nth fetch call. */
export function sentBody(fetchMock, n = 0) {
  return JSON.parse(fetchMock.mock.calls[n][1].body)
}

export async function readJson(res) {
  return JSON.parse(await res.text())
}

/** Minimal Node/Vercel-style `res` object for (req, res) handlers. */
export function makeNodeRes() {
  const res = {
    statusCode: undefined,
    headers: {},
    body: undefined,
    setHeader: vi.fn((k, v) => { res.headers[k.toLowerCase()] = v }),
    status: vi.fn((code) => { res.statusCode = code; return res }),
    json: vi.fn((obj) => { res.body = obj; return res }),
    end: vi.fn(),
  }
  return res
}
