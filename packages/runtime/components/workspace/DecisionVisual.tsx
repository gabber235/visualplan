import type { ReactNode } from 'react'

interface VisualProps {
  title: string
  children?: ReactNode
}

/** A custom explanation authored as MDX inside one PlanWorkspace decision. */
export function Visual({ title, children }: VisualProps) {
  return (
    <section className='vp-decision-visual' aria-label={title}>
      <h3>{title}</h3>
      <div className='vp-decision-visual__body'>{children}</div>
    </section>
  )
}
