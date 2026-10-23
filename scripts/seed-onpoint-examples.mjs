#!/usr/bin/env node
// Imports a private OnPoint answer bank into Supabase (onpoint_examples).
//
//   node --env-file=.env.local scripts/seed-onpoint-examples.mjs --email you@example.com
//   node --env-file=.env.local scripts/seed-onpoint-examples.mjs --household <uuid> --file path/to/examples.json
//
// Needs SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.
// The JSON is an array of { id, tags, questionKeywords, lead, context, metrics, category }.
// Default file: private/onpoint-examples.json (git-ignored). Re-running updates rows in place.

import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const { values: args } = parseArgs({
  options: {
    email: { type: 'string' },
    household: { type: 'string' },
    file: { type: 'string', default: 'private/onpoint-examples.json' },
  },
})

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) fail('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.')
if (!args.email && !args.household) fail('Pass --email or --household.')

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

const householdId = args.household ?? (await householdForEmail(args.email))
const examples = JSON.parse(readFileSync(args.file, 'utf8'))
if (!Array.isArray(examples)) fail(`${args.file} must contain a JSON array.`)

const rows = examples.map(e => ({
  household_id: householdId,
  slug: e.id,
  tags: e.tags ?? [],
  question_keywords: e.questionKeywords ?? [],
  lead: e.lead,
  context: e.context ?? '',
  metrics: e.metrics ?? '',
  category: e.category ?? '',
  updated_at: new Date().toISOString(),
}))

const { error } = await supabase.from('onpoint_examples').upsert(rows, { onConflict: 'household_id,slug' })
if (error) fail(error.message)
console.log(`Imported ${rows.length} examples into household ${householdId}.`)

async function householdForEmail(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) fail(error.message)
    const user = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (user) {
      const { data: links, error: linkError } = await supabase
        .from('user_households')
        .select('household_id')
        .eq('user_id', user.id)
      if (linkError) fail(linkError.message)
      if (!links?.length) fail(`${email} has no household yet. Sign in to the app once first.`)
      if (links.length > 1) fail(`${email} belongs to ${links.length} households. Pass --household explicitly.`)
      return links[0].household_id
    }
    if (data.users.length < 200) fail(`No user with email ${email}.`)
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
