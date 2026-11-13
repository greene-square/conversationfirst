import { useState } from 'react'
import { ChevronRightIcon } from '@heroicons/react/24/outline'

interface SectionAccordionProps {
  id: string
  title: string
  explainer: string
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  defaultOpen?: boolean
  children: React.ReactNode
}

export default function SectionAccordion({ id, title, explainer, icon: Icon, defaultOpen = false, children }: SectionAccordionProps) {
  const [open, setOpen] = useState(defaultOpen)
  // Children mount on open and unmount once the close transition ends, so
  // collapsed sections cost no DOM, effects or timers.
  const [rendered, setRendered] = useState(defaultOpen)
  const titleId = `${id}-title`
  const explainerId = `${id}-explainer`
  const contentId = `${id}-content`

  function toggle() {
    if (!open) setRendered(true)
    setOpen(o => !o)
  }

  function handleTransitionEnd(e: React.TransitionEvent<HTMLDivElement>) {
    // Ignore transitions bubbling up from the demos inside the panel.
    if (e.target === e.currentTarget && !open) setRendered(false)
  }

  // No region landmarks: ten always-expandable panels would flood the
  // landmark list. The <h2> gives screen reader users the structure.
  return (
    <section className="section-accordion" id={id} data-open={open}>
      <h2 className="section-accordion-header">
        <button
          type="button"
          className="section-accordion-trigger"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          aria-labelledby={titleId}
          aria-describedby={explainerId}
        >
          {Icon && (
            <span className="section-accordion-icon" aria-hidden="true">
              <Icon width={28} height={28} />
            </span>
          )}
          <span className="section-accordion-text">
            <span className="section-accordion-title" id={titleId}>{title}</span>
            <span className="section-accordion-explainer" id={explainerId}>{explainer}</span>
          </span>
          <ChevronRightIcon className="section-accordion-chevron" width={20} height={20} aria-hidden="true" />
        </button>
      </h2>
      {/* The 0fr→1fr row animation only hides content visually; inert also
          removes it from the tab order and accessibility tree while closed. */}
      <div
        className="section-accordion-body"
        id={contentId}
        inert={!open}
        onTransitionEnd={handleTransitionEnd}
      >
        <div className="section-accordion-inner">
          <div className="section-accordion-content">
            {rendered && children}
          </div>
        </div>
      </div>
    </section>
  )
}
