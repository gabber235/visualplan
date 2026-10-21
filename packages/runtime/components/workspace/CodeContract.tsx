import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkspaceDecision } from './model.js'
import { codeRemovalPart } from './model.js'
import { CodeRemoval } from './CodeRemoval.js'
import { reviewAnchor } from './feedback.js'
import { ReviewableCode, ReviewStatusBadge } from './ReviewControls.js'
import { reviewGroupId, codeReviewId } from './review-state.js'
import { useWorkspaceReview } from './WorkspaceReview.js'
import { ChangedCode, changeMark, useRevisionChanges } from './RevisionChanges.js'
import { changeKey } from './revision-diff.js'

interface CodeContractProps {
  decision: WorkspaceDecision
  codeBlocks?: Map<string, ReactNode>
  role?: 'model' | 'edit'
}

/** Side by side columns clip long lines, so wide code reads top to bottom instead. */
const SIDE_BY_SIDE_COLUMNS = 64

function stacksComparison(contract: WorkspaceDecision['code'][number]): boolean {
  return [contract.current, contract.proposed].some(text =>
    text?.split('\n').some(line => line.length > SIDE_BY_SIDE_COLUMNS),
  )
}

export function CodeContract({ decision, codeBlocks, role = 'edit' }: CodeContractProps) {
  const review = useWorkspaceReview()
  const revision = useRevisionChanges()
  const contracts = decision.code.filter(code => code.role === role)
  const queue = contracts
    .map(change => ({
      change,
      summary: review.summary(reviewGroupId(decision.id, 'contract', change.id)),
    }))
    .sort(
      (a, b) => Number(a.summary.unreviewedItems === 0) - Number(b.summary.unreviewedItems === 0),
    )
  const [selectedId, setSelectedId] = useState(queue[0]?.change.id ?? '')
  const toolbar = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLElement>(null)
  const panel = useRef<HTMLElement>(null)
  const navigation = useRef(false)
  const pendingCount = queue.filter(entry => entry.summary.unreviewedItems > 0).length
  const selected = queue.find(entry => entry.change.id === selectedId) ?? queue[0]
  const contract = selected?.change
  const nextId = queue.find(
    entry => entry.change.id !== contract?.id && entry.summary.unreviewedItems > 0,
  )?.change.id
  const selectedPending = (selected?.summary.unreviewedItems ?? 0) > 0
  const previousPending = useRef(selectedPending)

  const selectChange = (id: string) => {
    navigation.current = true
    previousPending.current = Boolean(
      queue.find(entry => entry.change.id === id)?.summary.unreviewedItems,
    )
    setSelectedId(id)
  }

  useLayoutEffect(() => {
    if (previousPending.current && !selectedPending && nextId) {
      navigation.current = true
      previousPending.current = true
      setSelectedId(nextId)
      if (strip.current) strip.current.scrollLeft = 0
      return
    }
    previousPending.current = selectedPending
    if (!navigation.current || !panel.current) return
    navigation.current = false
    panel.current.style.scrollMarginTop = `${(toolbar.current?.offsetHeight ?? 0) + 28}px`
    panel.current.scrollIntoView?.({ block: 'start', behavior: 'instant' })
    panel.current.focus({ preventScroll: true })
    const active = [
      ...(strip.current?.querySelectorAll<HTMLButtonElement>('[data-change-id]') ?? []),
    ].find(button => button.dataset.changeId === selectedId)
    if (active && strip.current) {
      const left = active.offsetLeft - strip.current.offsetLeft
      strip.current.scrollLeft = Math.max(0, left - 8)
    }
  }, [selectedPending, selectedId, nextId])

  if (!contract) return null
  const removalPart = codeRemovalPart(contract)
  const key = (...parts: string[]) =>
    changeKey('decision', decision.id, 'code', contract.id, ...parts)
  const slot = (part: 'current' | 'proposed' | 'diff') => (
    <ChangedCode changeKey={key(part)} current={contract[part] ?? ''}>
      {codeBlocks?.get(JSON.stringify([decision.id, contract.id, part])) ?? (
        <pre>
          <code>{contract[part]}</code>
        </pre>
      )}
    </ChangedCode>
  )

  return (
    <section
      className='vp-workspace__surface vp-change-review'
      aria-label={role === 'model' ? 'Model comparison' : 'Code changes'}
      data-status={
        role === 'model' ? undefined : review.status(reviewGroupId(decision.id, 'changes'))
      }
      {...reviewAnchor(
        role === 'model' ? 'model' : 'changes',
        role === 'model' ? 'Model comparison' : 'Code changes',
      )}
    >
      <div className='vp-workspace__surface-head'>
        <div>
          <h3>{role === 'model' ? 'Current and proposed model' : 'Change set'}</h3>
          {contracts.length > 1 ? (
            <span className='vp-change-review__count'>
              {contracts.length} {contracts.length === 1 ? 'item' : 'items'}
              {pendingCount ? `, ${pendingCount} unreviewed` : ', all reviewed'}
            </span>
          ) : null}
        </div>
        {role === 'edit' ? (
          <ReviewStatusBadge itemId={reviewGroupId(decision.id, 'changes')} />
        ) : null}
      </div>
      {queue.length > 1 ? (
        <div className='vp-change-review__toolbar' ref={toolbar} data-review-ui='true'>
          <nav
            className='vp-code-contract__index'
            aria-label={role === 'model' ? 'Model comparisons' : 'Change queue'}
            ref={strip}
          >
            {queue.map(({ change: candidate, summary }) => (
              <button
                type='button'
                key={candidate.id}
                data-change-id={candidate.id}
                data-active={candidate.id === contract.id}
                data-status={summary.status}
                data-reviewed={summary.unreviewedItems === 0}
                aria-pressed={candidate.id === contract.id}
                aria-label={`${candidate.symbol}, ${candidate.file}, ${summary.unreviewedItems ? `${summary.unreviewedItems} unreviewed` : summary.status}`}
                onClick={() => selectChange(candidate.id)}
              >
                <strong>
                  {revision.within('decision', decision.id, 'code', candidate.id) ? (
                    <span
                      className='vp-change-dot'
                      data-kind={
                        revision.field(changeKey('decision', decision.id, 'code', candidate.id))
                          ?.kind
                      }
                      title={`Changed since ${revision.since}`}
                    />
                  ) : null}{' '}
                  {candidate.symbol}
                </strong>
                <span className='vp-change-queue__file'>{candidate.file}</span>
                <span className='vp-change-queue__meta'>
                  <span data-change={candidate.change}>{candidate.change}</span>
                  <ReviewStatusBadge
                    itemId={reviewGroupId(decision.id, 'contract', candidate.id)}
                  />
                </span>
              </button>
            ))}
          </nav>
        </div>
      ) : null}
      <article
        className='vp-code-contract'
        ref={panel}
        tabIndex={-1}
        data-status={review.status(reviewGroupId(decision.id, 'contract', contract.id))}
        {...reviewAnchor(`code:${contract.id}`, `${contract.file}: ${contract.symbol}`)}
      >
        <header>
          <div>
            <div {...changeMark(revision, key(), `${contract.file}: ${contract.symbol}`)}>
              <div {...changeMark(revision, key('symbol'), `${contract.file}: ${contract.symbol}`)}>
                <span className='vp-code-contract__path'>{contract.file}</span>
                <h4 className='vp-code-contract__symbol'>{contract.symbol}</h4>
              </div>
            </div>
          </div>
          <ReviewStatusBadge itemId={reviewGroupId(decision.id, 'contract', contract.id)} />
        </header>
        {contract.summary ? (
          <p {...changeMark(revision, key('summary'), contract.summary)}>{contract.summary}</p>
        ) : null}
        {removalPart ? (
          <CodeRemoval
            key={contract.id}
            itemId={codeReviewId(decision.id, contract.id, removalPart)}
            part={removalPart}
          >
            {slot(removalPart)}
          </CodeRemoval>
        ) : contract.diff ? (
          <section className='vp-code-contract__unified' {...reviewAnchor('diff', 'Proposed diff')}>
            <ReviewableCode
              itemId={codeReviewId(decision.id, contract.id, 'diff')}
              label='Proposed diff'
            >
              {slot('diff')}
            </ReviewableCode>
          </section>
        ) : (
          <div
            className='vp-code-contract__diff'
            data-single={contract.current ? 'false' : 'true'}
            data-stacked={stacksComparison(contract)}
          >
            {contract.current ? (
              <section {...reviewAnchor('current', 'Existing code')}>
                <span className='vp-code-contract__side'>Current</span>
                {slot('current')}
              </section>
            ) : null}
            {contract.proposed ? (
              <section {...reviewAnchor('proposed', 'Proposed code')}>
                <ReviewableCode
                  itemId={codeReviewId(decision.id, contract.id, 'proposed')}
                  label='Proposed'
                >
                  {slot('proposed')}
                </ReviewableCode>
              </section>
            ) : null}
          </div>
        )}
        {contract.invariants.length || contract.callers.length ? (
          <div className='vp-code-contract__facts'>
            {contract.invariants.length > 0 ? (
              <div>
                <strong>Invariants</strong>
                <ul>
                  {contract.invariants.map(item => (
                    <li
                      key={item}
                      {...reviewAnchor(
                        `invariant:${contract.invariants.indexOf(item)}`,
                        'Code invariant',
                      )}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {contract.callers.length > 0 ? (
              <div>
                <strong>Callers</strong>
                <ul>
                  {contract.callers.map(item => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </article>
    </section>
  )
}
