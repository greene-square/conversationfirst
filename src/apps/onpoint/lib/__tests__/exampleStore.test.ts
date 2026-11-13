// Unit tests for src/apps/onpoint/lib/exampleStore.ts (household answer bank with sample fallback).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callArgs, type SupabaseMock } from '../../../../lib/__tests__/helpers/supabaseMock'

vi.mock('../../../../lib/supabase', async () => {
  const { createSupabaseMock } = await import('../../../../lib/__tests__/helpers/supabaseMock')
  return { supabase: createSupabaseMock() }
})

import { supabase } from '../../../../lib/supabase'
import { loadExampleBank } from '../exampleStore'
import { SAMPLE_EXAMPLES } from '../sampleExamples'

const sb = supabase as unknown as SupabaseMock

const row = {
  slug: 'my-story',
  tags: ['ai'],
  question_keywords: ['launch'],
  lead: 'Lead',
  context: 'Context',
  metrics: 'Metrics',
  category: 'ai-product',
}

describe('loadExampleBank', () => {
  beforeEach(() => sb.reset())

  it('uses the sample without querying when signed out', async () => {
    expect(await loadExampleBank(null)).toEqual({ examples: SAMPLE_EXAMPLES, source: 'sample' })
    expect(sb.queriesFor('onpoint_examples')).toHaveLength(0)
  })

  it('maps household rows to examples', async () => {
    sb.queue('onpoint_examples', { data: [row], error: null })
    const bank = await loadExampleBank('hh')
    expect(bank.source).toBe('household')
    expect(bank.examples).toEqual([{
      id: 'my-story',
      tags: ['ai'],
      questionKeywords: ['launch'],
      lead: 'Lead',
      context: 'Context',
      metrics: 'Metrics',
      category: 'ai-product',
    }])
    const [q] = sb.queriesFor('onpoint_examples')
    expect(callArgs(q, 'eq')).toEqual([['household_id', 'hh']])
  })

  it('treats null arrays as empty', async () => {
    sb.queue('onpoint_examples', { data: [{ ...row, tags: null, question_keywords: null }], error: null })
    const [example] = (await loadExampleBank('hh')).examples
    expect(example.tags).toEqual([])
    expect(example.questionKeywords).toEqual([])
  })

  it.each([
    ['nothing has been imported', { data: [], error: null }],
    ['the table does not exist yet', { data: null, error: { message: 'relation "onpoint_examples" does not exist' } }],
  ])('falls back to the sample when %s', async (_label, result) => {
    sb.queue('onpoint_examples', result)
    expect(await loadExampleBank('hh')).toEqual({ examples: SAMPLE_EXAMPLES, source: 'sample' })
  })
})

describe('SAMPLE_EXAMPLES', () => {
  it('is complete enough to match against', () => {
    expect(SAMPLE_EXAMPLES.length).toBeGreaterThanOrEqual(6)
    for (const e of SAMPLE_EXAMPLES) {
      expect(e.lead.length).toBeGreaterThan(0)
      expect(e.questionKeywords.length).toBeGreaterThan(0)
    }
  })
})
