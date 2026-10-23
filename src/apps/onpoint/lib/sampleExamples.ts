import type { Example } from './types'

// Fictional answer bank. It ships in the public bundle, so it must never hold
// real career details. Your own examples live in Supabase (onpoint_examples)
// and replace these once imported; see scripts/seed-onpoint-examples.mjs.
export const SAMPLE_EXAMPLES: Example[] = [
  {
    id: 'ai-launch',
    tags: ['ai', 'zero-to-one', 'product-launch', 'shipping'],
    questionKeywords: ['ship', 'launch', 'zero to one', 'new product', 'AI product'],
    lead: 'I led design for an AI writing assistant at Northwind Analytics, from concept to general availability in one quarter.',
    context: 'Early usage was flat because the assistant lived behind a menu. We moved it into the editor where people already wrote, and cut setup to one click.',
    metrics: 'Weekly active use went from 3% to 31% of accounts in eight weeks.',
    category: 'ai-product',
  },
  {
    id: 'ai-process',
    tags: ['ai', 'process', 'prototyping', 'evaluation'],
    questionKeywords: ['design process', 'AI design', 'prototype', 'evaluate quality'],
    lead: 'For AI features I prototype against real model output on day one instead of mocking ideal answers.',
    context: 'We built a small evaluation set from customer questions and reviewed transcripts every week with engineering.',
    metrics: 'Caught three failure modes before launch that static mockups would have hidden.',
    category: 'process',
  },
  {
    id: 'design-systems',
    tags: ['design-systems', 'consistency', 'scale', 'components'],
    questionKeywords: ['design system', 'consistency', 'component library', 'tokens'],
    lead: 'I rebuilt a fragmented component library into a token-driven design system used by six product teams.',
    context: 'Each team had forked buttons and forms. We started with tokens and the ten most used components, and measured adoption instead of mandating it.',
    metrics: 'UI review time dropped by half and accessibility defects fell 60% in two releases.',
    category: 'craft',
  },
  {
    id: 'stakeholder-conflict',
    tags: ['stakeholders', 'conflict', 'alignment'],
    questionKeywords: ['disagree', 'conflict', 'stakeholder', 'push back', 'difficult partner'],
    lead: 'A sales leader wanted a custom dashboard for one large customer. I disagreed and proposed a configurable view instead.',
    context: 'I brought usage data from twenty similar accounts and a quick prototype, and we agreed on criteria before debating solutions.',
    metrics: 'Shipped one feature that served 40 accounts instead of one.',
    category: 'leadership',
  },
  {
    id: 'team-growth',
    tags: ['hiring', 'team-scaling', 'mentoring'],
    questionKeywords: ['grow a team', 'hiring', 'build a team', 'mentor'],
    lead: 'I grew a design team from three to nine people while keeping quality steady.',
    context: 'I wrote a hiring rubric tied to our design principles and paired every new hire with a peer for their first project.',
    metrics: 'All six hires were still on the team two years later.',
    category: 'leadership',
  },
  {
    id: 'failure-lesson',
    tags: ['failure', 'learning', 'self-awareness'],
    questionKeywords: ['failure', 'mistake', 'went wrong', 'learn from'],
    lead: 'I shipped an onboarding redesign that looked better and converted worse.',
    context: 'I had tested comprehension but not motivation. We rolled back within a week and now test both before launch.',
    metrics: 'The second version recovered the drop and added 8% to activation.',
    category: 'self-awareness',
  },
  {
    id: 'research-impact',
    tags: ['research', 'customers', 'discovery'],
    questionKeywords: ['user research', 'customer insight', 'discovery', 'talk to customers'],
    lead: 'Five customer interviews changed our roadmap for a reporting product.',
    context: 'Customers did not want more charts. They wanted a weekly summary they could forward to their boss.',
    metrics: 'The summary email became the most used feature within a month.',
    category: 'research',
  },
  {
    id: 'measure-success',
    tags: ['metrics', 'outcomes', 'experimentation'],
    questionKeywords: ['measure success', 'metrics', 'impact', 'how do you know'],
    lead: 'I define success as a behaviour change we can observe, then pick the smallest metric that shows it.',
    context: 'For a search redesign that meant searches that ended in an opened result, not total searches.',
    metrics: 'Successful searches rose from 52% to 71%.',
    category: 'product-thinking',
  },
]
