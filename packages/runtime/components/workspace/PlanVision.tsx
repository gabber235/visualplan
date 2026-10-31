import { reviewAnchor } from './feedback.js'
import { scopeText, type WorkspaceModel } from './model.js'
import { ReviewControls } from './ReviewControls.js'
import { planReviewId } from './review-state.js'
import { RemovedItems, changeMark, useRevisionChanges } from './RevisionChanges.js'
import { changeKey, visionOwner } from './revision-diff.js'
import { useWorkspaceReview } from './WorkspaceReview.js'

/**
 * The confirmed intent of the plan: the problem, the outcome, and what is in and out of scope. Its
 * review mark is the plan approval, so a changed vision reopens it.
 */
export function PlanVision({ model }: { model: WorkspaceModel }) {
  const review = useWorkspaceReview()
  const revision = useRevisionChanges()
  if (!model.vision && !model.thesis) return null
  // Decisions carry the approval of an unchanged vision, so its own mark appears only when needed.
  const plan = review.summary(planReviewId)
  const confirm = plan.ownInvalidated || plan.ownStatus !== 'unreviewed'
  const vision = model.vision ?? {
    problem: model.thesis ?? '',
    outcome: model.thesis ?? '',
    principles: [],
    scope: [],
  }
  const scope = (status: 'in' | 'out', label: string) => {
    const items = vision.scope.filter(item => item.status === status)
    return items.length ? (
      <section className='vp-workspace__scope' data-scope={status} aria-label={label}>
        <span className='vp-workspace__scope-badge'>{status === 'in' ? 'In' : 'Out'}</span>
        <ul>
          {items.map(item => (
            <li
              key={item.id}
              {...reviewAnchor(`vision:scope:${item.id}`, `${label}: ${item.text}`)}
              {...changeMark(revision, changeKey('vision', 'scope', item.id), scopeText(item))}
            >
              {item.text}
            </li>
          ))}
        </ul>
      </section>
    ) : null
  }

  return (
    <header
      data-status={review.status(planReviewId)}
      className='vp-workspace__mast'
      {...reviewAnchor('vision', 'Plan vision')}
    >
      <div className='vp-workspace__vision-copy'>
        <div className='vp-workspace__vision-grid'>
          <section
            className='vp-workspace__vision-block'
            data-kind='problem'
            {...reviewAnchor('vision:problem', 'Why this change matters')}
          >
            <span className='vp-workspace__vision-label'>Problem</span>
            <p {...changeMark(revision, changeKey('vision', 'problem'), vision.problem)}>
              {vision.problem}
            </p>
          </section>
          <section
            className='vp-workspace__vision-block'
            data-kind='outcome'
            {...reviewAnchor('vision:outcome', 'Intended outcome')}
          >
            <span className='vp-workspace__vision-label'>Outcome</span>
            <p {...changeMark(revision, changeKey('vision', 'outcome'), vision.outcome)}>
              {vision.outcome}
            </p>
          </section>
        </div>
        {vision.scope.length ? (
          <section
            className='vp-workspace__vision-block vp-workspace__scope-block'
            aria-label='Scope'
          >
            <span className='vp-workspace__vision-label'>Scope</span>
            <div className='vp-workspace__scope-grid'>
              {scope('in', 'In scope')}
              {scope('out', 'Out of scope')}
            </div>
          </section>
        ) : null}
        {vision.principles.length > 0 ? (
          <ul className='vp-workspace__principles' aria-label='Design principles'>
            {vision.principles.map((principle, index) => (
              <li
                key={principle}
                {...reviewAnchor(`vision:principle:${index}`, 'Design principle')}
              >
                {principle}
              </li>
            ))}
          </ul>
        ) : null}
        <RemovedItems items={revision.changes?.removed.get(visionOwner) ?? []} />
      </div>
      {confirm ? <ReviewControls itemId={planReviewId} label='Vision' /> : null}
    </header>
  )
}
