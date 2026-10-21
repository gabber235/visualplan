import type { ReactNode } from 'react'
import { reviewAnchor } from './feedback.js'
import { ReviewableCode } from './ReviewControls.js'

export function CodeRemoval({
  itemId,
  part,
  children,
}: {
  itemId: string
  part: 'current' | 'diff'
  children: ReactNode
}) {
  return (
    <section className='vp-code-removal' {...reviewAnchor(part, 'Code to delete')}>
      <ReviewableCode itemId={itemId} label='Code to delete'>
        <details>
          <summary>View code to delete</summary>
          {children}
        </details>
      </ReviewableCode>
    </section>
  )
}
