import { useState } from 'react'
import {
  ArrowLeftIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  MicrophoneIcon,
} from '@heroicons/react/24/outline'
import type { VCSession } from '../lib/types'
import { formatDuration } from '../lib/storage'
import { sanitizeHtml } from '../../../lib/sanitizeHtml'

interface ResultViewProps {
  session: VCSession
  onBack: () => void
  onNewRecording: () => void
}

export default function ResultView({ session, onBack, onNewRecording }: ResultViewProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!session.structuredOutput) return
    try {
      await navigator.clipboard.writeText(session.structuredOutput)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for non-secure contexts
      const textarea = document.createElement('textarea')
      textarea.value = session.structuredOutput
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const rendered = session.structuredOutput
    ? sanitizeHtml(renderMarkdown(session.structuredOutput))
    : '<p>No structured output available.</p>'

  return (
    <div className="vc-result">
      <div className="vc-result-header">
        <button className="vc-btn-icon" onClick={onBack} aria-label="Back">
          <ArrowLeftIcon width={16} height={16} aria-hidden="true" />
        </button>
        <span className="vc-result-title">{session.title}</span>
        <div className="vc-result-actions">
          <span className="vc-result-duration">{formatDuration(session.durationMs)}</span>
          <button className="vc-btn-copy" onClick={handleCopy}>
            {copied ? (
              <>
                <CheckIcon width={14} height={14} aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <ClipboardDocumentIcon width={14} height={14} aria-hidden="true" />
                Copy
              </>
            )}
          </button>
          <button className="vc-btn-primary" onClick={onNewRecording}>
            <MicrophoneIcon width={14} height={14} aria-hidden="true" />
            New recording
          </button>
        </div>
      </div>

      <div className="vc-result-body">
        <div
          className="vc-structured-output"
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      </div>

      <details className="vc-raw-transcript">
        <summary className="vc-raw-transcript-toggle">Raw transcript</summary>
        <p className="vc-raw-transcript-text">{session.rawTranscript}</p>
      </details>
    </div>
  )
}

/**
 * Lightweight markdown renderer for the structured output.
 * Handles: ## headings, ### headings, **bold**, `code`, ```code blocks```,
 * - unordered lists, 1. ordered lists, and paragraphs.
 */
function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  const html: string[] = []
  let inCodeBlock = false
  let codeLines: string[] = []
  let inList: 'ul' | 'ol' | null = null

  function closeList() {
    if (inList) {
      html.push(inList === 'ul' ? '</ul>' : '</ol>')
      inList = null
    }
  }

  // Escape first: the output comes from a model and the raw transcript.
  function inlineFormat(text: string): string {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
        codeLines = []
        inCodeBlock = false
      } else {
        closeList()
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    const trimmed = line.trim()

    // Empty line
    if (!trimmed) {
      closeList()
      continue
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      closeList()
      html.push(`<h3>${inlineFormat(trimmed.slice(4))}</h3>`)
      continue
    }
    if (trimmed.startsWith('## ')) {
      closeList()
      html.push(`<h2>${inlineFormat(trimmed.slice(3))}</h2>`)
      continue
    }

    // Unordered list
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (inList !== 'ul') {
        closeList()
        html.push('<ul>')
        inList = 'ul'
      }
      html.push(`<li>${inlineFormat(trimmed.slice(2))}</li>`)
      continue
    }

    // Ordered list
    const olMatch = trimmed.match(/^(\d+)\.\s(.+)/)
    if (olMatch) {
      if (inList !== 'ol') {
        closeList()
        html.push('<ol>')
        inList = 'ol'
      }
      html.push(`<li>${inlineFormat(olMatch[2])}</li>`)
      continue
    }

    // Paragraph
    closeList()
    html.push(`<p>${inlineFormat(trimmed)}</p>`)
  }

  // Close any open code block
  if (inCodeBlock && codeLines.length) {
    html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
  }

  closeList()
  return html.join('\n')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
