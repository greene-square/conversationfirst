import { supabase } from '../../../lib/supabase'
import type { Example } from './types'
import { SAMPLE_EXAMPLES } from './sampleExamples'

export interface ExampleBank {
  examples: Example[]
  source: 'household' | 'sample'
}

interface ExampleRow {
  slug: string
  tags: string[] | null
  question_keywords: string[] | null
  lead: string
  context: string
  metrics: string
  category: string
}

function toExample(row: ExampleRow): Example {
  return {
    id: row.slug,
    tags: row.tags ?? [],
    questionKeywords: row.question_keywords ?? [],
    lead: row.lead,
    context: row.context,
    metrics: row.metrics,
    category: row.category,
  }
}

// Personal answer banks live in Supabase, scoped to the household by RLS, so
// they never ship in the public bundle. Falls back to the fictional sample when
// signed out, before the table exists, or before anything has been imported.
export async function loadExampleBank(householdId: string | null): Promise<ExampleBank> {
  if (!householdId) return { examples: SAMPLE_EXAMPLES, source: 'sample' }

  const { data, error } = await supabase
    .from('onpoint_examples')
    .select('slug, tags, question_keywords, lead, context, metrics, category')
    .eq('household_id', householdId)
    .order('slug')

  if (error || !data || data.length === 0) {
    return { examples: SAMPLE_EXAMPLES, source: 'sample' }
  }
  return { examples: (data as ExampleRow[]).map(toExample), source: 'household' }
}
