import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { planWorkspaceSchema } from '@visualplan/core'
import { decodeJson, validateProps } from '../validate.js'
import { CodeContract } from './CodeContract.js'
import { DeveloperExperience } from './DeveloperExperience.js'
import { DecisionWorkbench } from './DecisionWorkbench.js'
import type { WorkspaceModel } from './model.js'
import './workspace.css'
import { WorkspaceReview, useWorkspaceReview } from './WorkspaceReview.js'
import { reviewAnchor, workspaceRevision } from './feedback.js'
import { collectCodeSlots } from './code-slots.js'
import { ReviewStatusBadge } from './ReviewControls.js'
import { decisionReviewId, planReviewId } from './review-state.js'
import {
  RevisionChangesProvider,
  RevisionSummary,
  changeMark,
  useRevisionChanges,
} from './RevisionChanges.js'
import { changeKey } from './revision-diff.js'

interface PlanWorkspaceProps {
  model: unknown
  children?: ReactNode
}

export function PlanWorkspace(props: PlanWorkspaceProps) {
  const model = useMemo(
    () =>
      validateProps(
        'PlanWorkspace',
        planWorkspaceSchema,
        decodeJson(props.model),
      ) as WorkspaceModel,
    [props.model],
  )
  return (
    <WorkspaceReview key={workspaceRevision(model)} model={model}>
      <RevisionChangesProvider model={model}>
        <WorkspaceContent model={model}>{props.children}</WorkspaceContent>
      </RevisionChangesProvider>
    </WorkspaceReview>
  )
}

function WorkspaceContent({ model, children }: { model: WorkspaceModel; children?: ReactNode }) {
  const review = useWorkspaceReview()
  const revision = useRevisionChanges()
  const codeSlots = useMemo(() => collectCodeSlots(children), [children])
  const [decisionId, setDecisionId] = useState(model.decisions[0]?.id ?? '')
  const decision =
    model.decisions.find(candidate => candidate.id === decisionId) ?? model.decisions[0]
  const vision = model.vision ?? {
    problem: model.thesis ?? '',
    outcome: model.thesis ?? '',
    principles: [],
  }

  useEffect(() => {
    if (!model.decisions.some(candidate => candidate.id === decisionId)) {
      setDecisionId(model.decisions[0]?.id ?? '')
    }
  }, [decisionId, model])

  const reviewed = model.decisions.filter(
    item => review.status(decisionReviewId(item.id)) === 'accepted',
  ).length
  const codeItems = [...review.items.values()].filter(item => item.kind === 'code')
  const markedCode = codeItems.filter(item => review.status(item.id) !== 'unreviewed').length
  const changedCode = codeItems.filter(item => review.state.reviews[item.id]?.invalidated).length

  if (!decision) return null

  return (
    <>
      <div hidden aria-hidden='true'>
        {codeSlots.styles}
      </div>
      {model.vision || model.thesis ? (
        <header
          data-status={review.status(planReviewId)}
          className='vp-workspace__mast'
          {...reviewAnchor('vision', 'Plan vision')}
        >
          <div className='vp-workspace__vision-copy'>
            <div className='vp-workspace__vision-grid'>
              <section {...reviewAnchor('vision:problem', 'Why this change matters')}>
                <span className='vp-workspace__vision-label'>Current problem</span>
                <strong {...changeMark(revision, changeKey('vision', 'problem'), vision.problem)}>
                  {vision.problem}
                </strong>
              </section>
              <section {...reviewAnchor('vision:outcome', 'Intended outcome')}>
                <span className='vp-workspace__vision-label'>Intended outcome</span>
                <strong {...changeMark(revision, changeKey('vision', 'outcome'), vision.outcome)}>
                  {vision.outcome}
                </strong>
              </section>
            </div>
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
          </div>
        </header>
      ) : null}
      <div className='vp-review-progress'>
        <div
          className='vp-review-progress__track'
          role='progressbar'
          aria-label={`${reviewed} of ${model.decisions.length} decisions accepted`}
          aria-valuemin={0}
          aria-valuemax={model.decisions.length}
          aria-valuenow={reviewed}
        >
          <span style={{ width: `${(reviewed / model.decisions.length) * 100}%` }} />
        </div>
        <p role='status'>
          {reviewed} of {model.decisions.length} decisions accepted. {markedCode} of{' '}
          {codeItems.length} blocks reviewed
          {changedCode ? `, ${changedCode} changed since your review` : ''}.
        </p>
      </div>
      <RevisionSummary />

      {model.decisions.length > 1 ? (
        <nav className='vp-workspace__decisions' aria-label='Technical decisions'>
          {model.decisions.map((item, index) => (
            <button
              type='button'
              key={item.id}
              data-active={item.id === decision.id}
              aria-pressed={item.id === decision.id}
              data-status={review.status(decisionReviewId(item.id))}
              onClick={() => setDecisionId(item.id)}
            >
              <span className='vp-workspace__decision-number'>{index + 1}</span>
              <strong>{item.title}</strong>
              <span className='vp-workspace__decision-meta'>
                <ReviewStatusBadge itemId={decisionReviewId(item.id)} />
                <DecisionChanges id={item.id} />
              </span>
            </button>
          ))}
        </nav>
      ) : null}

      <div
        className='vp-workspace__main'
        {...reviewAnchor(`decision:${decision.id}`, `${decision.id}: ${decision.title}`)}
      >
        <DecisionWorkbench
          decision={decision}
          reviewStatus={review.status(decisionReviewId(decision.id))}
          visuals={decision.visuals.map(visual => (
            <div
              key={visual.id}
              {...reviewAnchor(`visual:${visual.id}`, visual.title)}
              {...changeMark(revision, changeKey('decision', decision.id, 'visual', visual.id))}
            >
              {codeSlots.visuals.get(JSON.stringify([decision.id, visual.id]))}
            </div>
          ))}
        >
          <CodeContract
            key={`${decision.id}:model`}
            decision={decision}
            codeBlocks={codeSlots.blocks}
            role='model'
          />
        </DecisionWorkbench>
        <DeveloperExperience decision={decision} codeBlocks={codeSlots.blocks} />
        <CodeContract key={decision.id} decision={decision} codeBlocks={codeSlots.blocks} />
      </div>
    </>
  )
}

/** How much changed inside one decision since the revision the reader last opened. */
function DecisionChanges({ id }: { id: string }) {
  const revision = useRevisionChanges()
  if (!revision.visible || !revision.changes) return null
  if (revision.field(changeKey('decision', id)))
    return (
      <span className='vp-change-count' data-kind='added'>
        <span className='vp-change-dot' data-kind='added' />
        New
      </span>
    )
  const count = revision.changes.counts.get(id) ?? 0
  if (!count) return null
  return (
    <span className='vp-change-count'>
      <span className='vp-change-dot' />
      {count} changed
    </span>
  )
}
