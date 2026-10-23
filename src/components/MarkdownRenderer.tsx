import { useMemo, useRef, useEffect, useCallback } from 'react';
import { marked } from 'marked';
import { sanitizeHtml } from '../lib/sanitizeHtml';

marked.setOptions({
  gfm: true,
  breaks: false,
});

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

marked.use({
  renderer: {
    table(token) {
      const ths = token.header.map((cell, i) => {
        const content = this.parser.parseInline(cell.tokens);
        const align = token.align[i];
        const style = align ? ` style="text-align:${align}"` : '';
        return `<th${style}>${content}</th>`;
      }).join('');
      const trs = token.rows.map(row => {
        const tds = row.map((cell, i) => {
          const content = this.parser.parseInline(cell.tokens);
          const align = token.align[i];
          const style = align ? ` style="text-align:${align}"` : '';
          return `<td${style}>${content}</td>`;
        }).join('');
        return `<tr>${tds}</tr>`;
      }).join('\n');
      return `<div class="table-scroll-wrapper"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
    },
    code(token) {
      if (token.lang === 'cf-preview') {
        return `<div class="cf-preview">${token.text}</div>`;
      }
      const langLabel = token.lang || 'code';
      const escaped = escapeHtml(token.text);
      return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-block-lang">${escapeHtml(langLabel)}</span><button class="code-copy-btn" type="button" aria-label="Copy code"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span class="code-copy-label">Copy</span></button></div><pre><code${token.lang ? ` class="language-${escapeHtml(token.lang)}"` : ''}>${escaped}</code></pre></div>`;
    }
  }
});

export default function MarkdownRenderer({ content }) {
  // Answers (and cf-preview blocks) come from the model, so sanitise them.
  const html = useMemo(() => sanitizeHtml(marked.parse(content || '') as string), [content]);
  const containerRef = useRef(null);

  const handleClick = useCallback((e) => {
    const btn = e.target.closest('.code-copy-btn');
    if (!btn) return;

    const wrapper = btn.closest('.code-block-wrapper');
    const codeEl = wrapper?.querySelector('pre code');
    if (!codeEl) return;

    navigator.clipboard.writeText(codeEl.textContent).then(() => {
      const label = btn.querySelector('.code-copy-label');
      if (label) {
        label.textContent = 'Copied';
        setTimeout(() => { label.textContent = 'Copy'; }, 2000);
      }
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('click', handleClick);
    return () => el.removeEventListener('click', handleClick);
  }, [handleClick]);

  return <div ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />;
}
