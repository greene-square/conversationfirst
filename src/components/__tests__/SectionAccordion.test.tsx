import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import SectionAccordion from '../SectionAccordion'

function renderAccordion(props: Partial<React.ComponentProps<typeof SectionAccordion>> = {}) {
  return render(
    <>
      <SectionAccordion id="citations" title="Citation system" explainer="Every claim links to its source." {...props}>
        {props.children ?? (
          <>
            <a href="https://example.com/source">Source link</a>
            <button type="button">Demo action</button>
          </>
        )}
      </SectionAccordion>
      <button type="button">After accordion</button>
    </>,
  )
}

const trigger = () => screen.getByRole('button', { name: /^Citation system/ })
const panel = () => document.getElementById('citations-content')!

describe('SectionAccordion', () => {
  it('names the trigger by its title and describes it with the explainer', () => {
    renderAccordion()
    expect(trigger()).toHaveAccessibleName('Citation system')
    expect(trigger()).toHaveAccessibleDescription('Every claim links to its source.')
    expect(trigger()).toHaveAttribute('type', 'button')
    expect(trigger().closest('h2')).not.toBeNull()
  })

  it('starts collapsed with an inert, empty panel', () => {
    renderAccordion()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).toHaveAttribute('aria-controls', 'citations-content')
    expect(panel()).toHaveAttribute('inert')
    expect(screen.queryByText('Source link')).not.toBeInTheDocument()
  })

  it('keeps collapsed content out of the tab order', async () => {
    const user = userEvent.setup()
    renderAccordion()
    await user.tab()
    expect(trigger()).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'After accordion' })).toHaveFocus()
  })

  it('mounts content and makes it reachable when opened', async () => {
    const user = userEvent.setup()
    renderAccordion()
    await user.click(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(panel()).not.toHaveAttribute('inert')
    await user.tab()
    expect(screen.getByRole('link', { name: 'Source link' })).toHaveFocus()
  })

  it('makes content inert immediately on close and unmounts it after the transition', async () => {
    const user = userEvent.setup()
    renderAccordion()
    await user.click(trigger())
    await user.click(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(panel()).toHaveAttribute('inert')
    // Still mounted while the close animation runs.
    expect(screen.getByText('Source link')).toBeInTheDocument()

    fireEvent.transitionEnd(panel())
    expect(screen.queryByText('Source link')).not.toBeInTheDocument()
  })

  it('ignores transitions that bubble up from the content', async () => {
    const user = userEvent.setup()
    renderAccordion()
    await user.click(trigger())
    await user.click(trigger())
    fireEvent.transitionEnd(screen.getByText('Source link'))
    expect(screen.getByText('Source link')).toBeInTheDocument()
  })

  it('keeps content when reopened before the close transition ends', async () => {
    const user = userEvent.setup()
    renderAccordion()
    await user.click(trigger())
    await user.click(trigger())
    await user.click(trigger())
    fireEvent.transitionEnd(panel())
    expect(screen.getByText('Source link')).toBeInTheDocument()
    expect(panel()).not.toHaveAttribute('inert')
  })

  it('renders content immediately when defaultOpen', () => {
    renderAccordion({ defaultOpen: true })
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Source link')).toBeInTheDocument()
  })

  it('does not run content effects until first opened, and stops them once closed', async () => {
    const user = userEvent.setup()
    const mounted = vi.fn()
    const unmounted = vi.fn()
    function Demo() {
      useEffect(() => {
        mounted()
        return unmounted
      }, [])
      return <p>Demo with a timer</p>
    }
    renderAccordion({ children: <Demo /> })
    expect(mounted).not.toHaveBeenCalled()

    await user.click(trigger())
    expect(mounted).toHaveBeenCalledTimes(1)

    await user.click(trigger())
    fireEvent.transitionEnd(panel())
    expect(unmounted).toHaveBeenCalledTimes(1)
  })

  it('does not create landmark regions', () => {
    renderAccordion({ defaultOpen: true })
    expect(screen.queryAllByRole('region')).toHaveLength(0)
  })
})
