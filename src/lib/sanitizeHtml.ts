import DOMPurify from 'dompurify'

// Model output is untrusted: answers can be steered by web pages the model
// read during search. Everything rendered as HTML goes through here.
//
// DOMPurify removes scripts, event handlers, iframes and javascript: URLs.
// On top of that we keep inline styles (cf-preview layouts use them) but drop
// declarations that could cover the page or load remote resources, and make
// links open safely in a new tab.

const purifier = DOMPurify()

const BLOCKED_STYLE_PROPS = new Set([
  'position', 'inset', 'top', 'right', 'bottom', 'left', 'z-index', 'transform', 'translate',
])
const BLOCKED_STYLE_VALUE = /url\s*\(|expression\s*\(|javascript:|@import/i

function cleanStyle(style: string): string {
  return style
    .split(';')
    .map(decl => decl.trim())
    .filter(decl => {
      const colon = decl.indexOf(':')
      if (colon <= 0) return false
      const prop = decl.slice(0, colon).trim().toLowerCase()
      return !BLOCKED_STYLE_PROPS.has(prop) && !BLOCKED_STYLE_VALUE.test(decl)
    })
    .join('; ')
}

purifier.addHook('afterSanitizeAttributes', node => {
  if (node.hasAttribute('style')) {
    const style = cleanStyle(node.getAttribute('style') || '')
    if (style) node.setAttribute('style', style)
    else node.removeAttribute('style')
  }
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    const href = node.getAttribute('href') || ''
    if (!href.startsWith('#')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  }
  if (node.tagName === 'IMG') {
    node.setAttribute('referrerpolicy', 'no-referrer')
    node.setAttribute('loading', 'lazy')
  }
})

export function sanitizeHtml(html: string): string {
  return purifier.sanitize(html, {
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'form'],
    FORBID_ATTR: ['formaction', 'action'],
  })
}
