import type { ReactNode } from 'react'
import type { WorkspaceDecision } from './model.js'
import { reviewAnchor } from './feedback.js'
import { ReviewControls, ReviewStatusBadge } from './ReviewControls.js'
import { decisionReviewId } from './review-state.js'
import { OwnershipComparison } from './OwnershipComparison.js'
import { RemovedItems, changeMark, useRevisionChanges } from './RevisionChanges.js'
import { changeKey } from './revision-diff.js'

interface DecisionWorkbenchProps {
  decision: WorkspaceDecision
  reviewStatus: string
  visuals?: ReactNode
  children?: ReactNode
}

export function DecisionWorkbench({
  decision,
  reviewStatus,
  visuals,
  children,
}: DecisionWorkbenchProps) {
  const revision = useRevisionChanges()
  const key = (...parts: string[]) => changeKey('decision', decision.id, ...parts)
  const goal = decision.goal ?? decision.summary ?? ''
  const reasoning = decision.reasoning ?? {
    benefits: decision.rationale ? [{ title: decision.rationale }] : [],
    costs: [],
  }
  return (
    <aside
      data-status={reviewStatus}
      className='vp-decision-workbench'
      aria-label={`Decision ${decision.id}`}
    >
      <header>
        <div className='vp-decision-workbench__identity'>
          <ReviewStatusBadge itemId={decisionReviewId(decision.id)} />
        </div>
        <ReviewControls key={decision.id} itemId={decisionReviewId(decision.id)} />
        <div className='vp-decision-workbench__heading'>
          <h2 {...changeMark(revision, key('title'), decision.title)}>{decision.title}</h2>
          {goal ? (
            <p
              {...reviewAnchor('goal', 'Decision goal')}
              {...changeMark(revision, key('goal'), goal)}
            >
              {goal}
            </p>
          ) : null}
        </div>
        <RemovedItems items={revision.changes?.removed.get(decision.id) ?? []} />
      </header>
      {visuals}
      {children}
      <OwnershipComparison decision={decision} />
      {reasoning.benefits.length || reasoning.costs.length ? (
        <section className='vp-decision-workbench__reasoning' aria-label='Decision reasoning'>
          {reasoning.benefits.map((item, index) => (
            <article
              key={`benefit:${item.id ?? item.title}`}
              data-kind='benefit'
              {...reviewAnchor(`benefit:${item.id ?? index}`, `Benefit: ${item.title}`)}
              {...changeMark(
                revision,
                key('benefit', item.id ?? String(index)),
                item.detail ? `${item.title}\n${item.detail}` : item.title,
              )}
            >
              <span>Benefit</span>
              <strong>{item.title}</strong>
              {item.detail ? <p>{item.detail}</p> : null}
            </article>
          ))}
          {reasoning.costs.map((item, index) => (
            <article
              key={`cost:${item.id ?? item.title}`}
              data-kind='cost'
              {...reviewAnchor(`cost:${item.id ?? index}`, `Cost: ${item.title}`)}
              {...changeMark(
                revision,
                key('cost', item.id ?? String(index)),
                item.detail ? `${item.title}\n${item.detail}` : item.title,
              )}
            >
              <span>Cost</span>
              <strong>{item.title}</strong>
              {item.detail ? <p>{item.detail}</p> : null}
            </article>
          ))}
        </section>
      ) : null}
    </aside>
  )
}
