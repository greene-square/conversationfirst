// Chainable fake of the Supabase JS client used by unit tests.
//
// Every `from(table)` call returns a Proxy builder that records each chained
// method call (select/eq/order/range/insert/...) and is thenable, so
// `await supabase.from('x').select('*').eq('a', 1)` resolves to a result.
//
// Results are configured per table:
//   sb.queue('table', { data, error }, ...)   -> consumed in order, one per awaited query
//   sb.setDefault('table', { data, error })    -> used when the queue is empty
//   a result may also be a function (record) => result, for dynamic responses
//
// Recorded queries are in `sb.queries` (in creation order) with helpers
// `sb.queriesFor(table)` and `callArgs(record, 'eq')`.
import { vi } from 'vitest'

export interface Call {
  method: string
  args: any[]
}

export interface QueryRecord {
  table: string
  calls: Call[]
}

export type Result = { data?: any; error?: any; count?: number }
export type ResultSpec = Result | ((record: QueryRecord) => Result | Promise<Result>)

export interface SupabaseMock {
  from: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
  auth: {
    getUser: ReturnType<typeof vi.fn>
    getSession: ReturnType<typeof vi.fn>
  }
  storage: {
    from: ReturnType<typeof vi.fn>
    bucket: {
      upload: ReturnType<typeof vi.fn>
      getPublicUrl: ReturnType<typeof vi.fn>
      remove: ReturnType<typeof vi.fn>
    }
  }
  queries: QueryRecord[]
  queue: (table: string, ...results: ResultSpec[]) => void
  setDefault: (table: string, result: ResultSpec) => void
  queriesFor: (table: string) => QueryRecord[]
  reset: () => void
}

export function callArgs(record: QueryRecord, method: string): any[][] {
  return record.calls.filter(c => c.method === method).map(c => c.args)
}

export function methods(record: QueryRecord): string[] {
  return record.calls.map(c => c.method)
}

export function createSupabaseMock(): SupabaseMock {
  const queues = new Map<string, ResultSpec[]>()
  const defaults = new Map<string, ResultSpec>()
  const queries: QueryRecord[] = []

  function nextResult(record: QueryRecord): Promise<Result> {
    const q = queues.get(record.table)
    let spec: ResultSpec | undefined
    if (q && q.length > 0) spec = q.shift()
    else spec = defaults.get(record.table)
    if (!spec) return Promise.resolve({ data: null, error: null })
    return Promise.resolve(typeof spec === 'function' ? spec(record) : spec)
  }

  function makeBuilder(table: string) {
    const record: QueryRecord = { table, calls: [] }
    queries.push(record)
    let pending: Promise<Result> | null = null
    const builder: any = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then') {
            return (resolve: any, reject: any) => {
              if (!pending) pending = nextResult(record)
              return pending.then(resolve, reject)
            }
          }
          if (prop === 'catch' || prop === 'finally') {
            return (...args: any[]) => {
              if (!pending) pending = nextResult(record)
              return (pending as any)[prop](...args)
            }
          }
          return (...args: any[]) => {
            record.calls.push({ method: prop, args })
            return builder
          }
        },
      }
    )
    return builder
  }

  const bucket = {
    upload: vi.fn(async () => ({ data: { path: 'x' }, error: null })),
    getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } })),
    remove: vi.fn(async () => ({ data: [], error: null })),
  }

  const mock: SupabaseMock = {
    from: vi.fn((table: string) => makeBuilder(table)),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    },
    storage: {
      from: vi.fn(() => bucket),
      bucket,
    },
    queries,
    queue(table, ...results) {
      const q = queues.get(table) ?? []
      q.push(...results)
      queues.set(table, q)
    },
    setDefault(table, result) {
      defaults.set(table, result)
    },
    queriesFor(table) {
      return queries.filter(q => q.table === table)
    },
    reset() {
      queues.clear()
      defaults.clear()
      queries.length = 0
      mock.from.mockClear()
      mock.rpc.mockReset()
      mock.rpc.mockImplementation(async () => ({ data: null, error: null }))
      mock.auth.getUser.mockReset()
      mock.auth.getUser.mockImplementation(async () => ({ data: { user: null }, error: null }))
      mock.auth.getSession.mockReset()
      mock.auth.getSession.mockImplementation(async () => ({ data: { session: null }, error: null }))
      mock.storage.from.mockClear()
      bucket.upload.mockReset()
      bucket.upload.mockImplementation(async () => ({ data: { path: 'x' }, error: null }))
      bucket.getPublicUrl.mockReset()
      bucket.getPublicUrl.mockImplementation((path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }))
      bucket.remove.mockReset()
      bucket.remove.mockImplementation(async () => ({ data: [], error: null }))
    },
  }
  return mock
}

// ─── SSE helpers ────────────────────────────────

const encoder = new TextEncoder()

/** Build a ReadableStream that emits the given string chunks (as UTF-8 bytes). */
export function streamOf(chunks: Array<string | Uint8Array>, opts?: { errorAfter?: boolean; error?: any }) {
  // Pull-based so that each chunk is delivered as a separate read() and an
  // error raised after the last chunk does not discard already-queued chunks.
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        const c = chunks[i++]
        controller.enqueue(typeof c === 'string' ? encoder.encode(c) : c)
        return
      }
      if (opts?.errorAfter) controller.error(opts.error ?? new Error('boom'))
      else controller.close()
    },
  }, { highWaterMark: 0 })
}

/** Format an object as a single SSE `data:` event line (with blank-line terminator). */
export function sse(obj: unknown, event?: string): string {
  return `${event ? `event: ${event}\n` : ''}data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`
}

/** A fetch Response wrapper around a stream body. */
export function sseResponse(chunks: Array<string | Uint8Array>, init?: ResponseInit & { errorAfter?: boolean }) {
  return new Response(streamOf(chunks, { errorAfter: init?.errorAfter }), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
