import { reviewAnchor } from './feedback.js'
import { scopeText, type WorkspaceModel } from './model.js'
import { ReviewControls } from './ReviewControls.js'
import { planReviewId } from './review-state.js'
import { RemovedItems, changeMark, useRevisionChanges } from './RevisionChanges.js'
import { changeKey, visionOwner } from './revision-diff.js'
import { useWorkspaceReview } from './WorkspaceReview.js'

/**
 * The confirmed intent of the plan: the problem, the outcome, what is in and out of scope, and the
 * facts the plan relies on. Its review mark is the plan approval, so a changed vision reopens it.
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
    facts: [],
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
        {vision.facts.length ? (
          <section
            className='vp-workspace__vision-block vp-workspace__facts'
            aria-label='Relies on'
          >
            <span className='vp-workspace__vision-label'>Relies on</span>
            <ul>
              {vision.facts.map(fact => (
                <li
                  key={fact.id}
                  {...reviewAnchor(`vision:fact:${fact.id}`, `Relies on: ${fact.claim}`)}
                  {...changeMark(
                    revision,
                    changeKey('vision', 'fact', fact.id),
                    `${fact.claim}\n${fact.source}`,
                  )}
                >
                  <span>{fact.claim}</span>
                  <FactSource source={fact.source} />
                </li>
              ))}
            </ul>
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

/** Path segments a shortened source keeps, enough to recognize the file without the full route. */
const keptSegments = 2

/** Shortens each long path in a source to its tail, so a fact row stays one scannable line. */
export function shortSource(source: string): string {
  return source
    .split(' ')
    .map(token => {
      const segments = token.split('/')
      return segments.length > keptSegments + 1
        ? `\u2026/${segments.slice(-keptSegments).join('/')}`
        : token
    })
    .join(' ')
}

/** A fact source in small mono; a shortened path shows in full on hover and to assistive tech. */
function FactSource({ source }: { source: string }) {
  const short = shortSource(source)
  if (short === source) return <cite>{source}</cite>
  return (
    <cite title={source}>
      <span aria-hidden='true'>{short}</span>
      <span className='vp-workspace__fact-full'>{source}</span>
    </cite>
  )
}
