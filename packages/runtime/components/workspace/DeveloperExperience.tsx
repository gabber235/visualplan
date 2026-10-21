import type { ReactNode } from 'react'
import type { WorkspaceDecision } from './model.js'
import { reviewAnchor } from './feedback.js'
import { ReviewableCode, ReviewStatusBadge } from './ReviewControls.js'
import { exampleReviewId, reviewGroupId } from './review-state.js'
import { useWorkspaceReview } from './WorkspaceReview.js'
import { ChangedCode, changeMark, useRevisionChanges } from './RevisionChanges.js'
import { changeKey } from './revision-diff.js'

interface DeveloperExperienceProps {
  decision: WorkspaceDecision
  codeBlocks?: Map<string, ReactNode>
}

export function DeveloperExperience({ decision, codeBlocks }: DeveloperExperienceProps) {
  const review = useWorkspaceReview()
  const revision = useRevisionChanges()
  if (!decision.examples.length) return null

  return (
    <section
      className='vp-developer-experience vp-workspace__surface'
      aria-label='Examples'
      {...reviewAnchor('developer-experience', 'Developer experience')}
    >
      <div className='vp-workspace__surface-head'>
        <div>
          <h3>Examples</h3>
        </div>
      </div>
      {decision.examples.map(example => {
        const key = (...parts: string[]) =>
          changeKey('decision', decision.id, 'example', example.id, ...parts)
        const block = (part: 'code' | 'result', fallback: string) => (
          <ChangedCode changeKey={key(part)} current={fallback}>
            {codeBlocks?.get(JSON.stringify([decision.id, 'example', example.id, part])) ?? (
              <pre>
                <code>{fallback}</code>
              </pre>
            )}
          </ChangedCode>
        )
        return (
          <article
            key={example.id}
            className='vp-developer-experience__example'
            data-status={review.status(reviewGroupId(decision.id, 'example', example.id))}
            {...reviewAnchor(`example:${example.id}`, example.title)}
          >
            <header {...changeMark(revision, key())}>
              <div className='vp-developer-experience__heading'>
                <h4 {...changeMark(revision, key('title'), example.title)}>{example.title}</h4>
                <ReviewStatusBadge itemId={reviewGroupId(decision.id, 'example', example.id)} />
              </div>
              {example.description ? (
                <p {...changeMark(revision, key('description'), example.description)}>
                  {example.description}
                </p>
              ) : null}
            </header>
            <div className='vp-developer-experience__body'>
              <section
                className='vp-developer-experience__usage'
                {...reviewAnchor('usage', 'Illustrative usage')}
              >
                <ReviewableCode
                  itemId={exampleReviewId(decision.id, example.id, 'code')}
                  label='Usage'
                >
                  {block('code', example.code)}
                </ReviewableCode>
              </section>
              {example.outcome || example.result ? (
                <section
                  className='vp-developer-experience__outcome'
                  {...reviewAnchor('outcome', 'Expected behavior')}
                >
                  {example.outcome ? (
                    <p {...changeMark(revision, key('outcome'), example.outcome)}>
                      {example.outcome}
                    </p>
                  ) : null}
                  {example.result ? (
                    <div {...reviewAnchor('result', `Result: ${example.result.label}`)}>
                      <strong>{example.result.label}</strong>
                      {block('result', example.result.value)}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </article>
        )
      })}
    </section>
  )
}
