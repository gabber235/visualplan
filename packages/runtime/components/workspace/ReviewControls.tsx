import { useState, type ReactNode } from 'react'
import { useWorkspaceReview } from './WorkspaceReview.js'
import { changedReviewFields, reviewLineDiff } from './review-state.js'
import './review-controls.css'

export function ReviewStatusBadge({ itemId, label }: { itemId: string; label?: string }) {
  const review = useWorkspaceReview()
  const { status, invalidated } = review.summary(itemId)
  if (status === 'unreviewed' && !invalidated) return null
  const text =
    status === 'unreviewed'
      ? invalidated
        ? 'Changed'
        : 'Unreviewed'
      : status === 'accepted'
        ? 'Accepted'
        : 'Denied'
  return (
    <span className='vp-review-status' data-status={status} data-invalidated={invalidated}>
      {label ? `${label}: ${text}` : text}
    </span>
  )
}

export function ReviewControls({ itemId, label }: { itemId: string; label?: string }) {
  const review = useWorkspaceReview()
  const item = review.items.get(itemId)
  const [showChanges, setShowChanges] = useState(false)
  if (!item) throw new Error(`Unknown review item: ${itemId}`)
  const { status, ownStatus, deniedChildren, ownInvalidated } = review.summary(itemId)
  const undoAccept = ownStatus === 'accepted' && status !== 'unreviewed'
  const automaticallyAccepted = status === 'accepted' && ownStatus !== 'accepted'
  const record = review.state.reviews[itemId]
  const changed = ownInvalidated

  return (
    <div className='vp-item-review' data-review-ui='true' data-status={status}>
      <div className='vp-item-review__bar'>
        {label ? <span className='vp-item-review__label'>{label}</span> : null}
        <fieldset className='vp-item-review__controls' aria-label={`${item.label} review`}>
          <button
            type='button'
            data-action='deny'
            aria-pressed={ownStatus === 'denied'}
            aria-label={`${ownStatus === 'denied' ? 'Undo deny' : 'Deny'} ${item.label}`}
            onClick={() =>
              review.setStatus(itemId, ownStatus === 'denied' ? 'unreviewed' : 'denied')
            }
          >
            {ownStatus === 'denied' ? 'Undo deny' : 'Deny'}
          </button>
          <button
            type='button'
            data-action='accept'
            aria-pressed={status === 'accepted'}
            disabled={automaticallyAccepted || (deniedChildren > 0 && !undoAccept)}
            aria-label={`${automaticallyAccepted ? 'Accepted' : undoAccept ? 'Undo accept' : 'Accept'} ${item.label}`}
            onClick={() => review.setStatus(itemId, undoAccept ? 'unreviewed' : 'accepted')}
          >
            {automaticallyAccepted ? 'Accepted' : undoAccept ? 'Undo accept' : 'Accept'}
          </button>
        </fieldset>
      </div>
      {deniedChildren > 0 ? (
        <p className='vp-item-review__blocked' role='status'>
          {deniedChildren} nested {deniedChildren === 1 ? 'item is' : 'items are'} denied. Resolve
          {deniedChildren === 1 ? ' it' : ' them'} before accepting this decision.
        </p>
      ) : null}
      {changed && record ? (
        <details
          className='vp-item-review__changes'
          onToggle={event => setShowChanges(event.currentTarget.open)}
        >
          <summary>Show changes since review</summary>
          {showChanges ? (
            <div>
              {changedReviewFields(item, record).map(({ key, previous, current }) => (
                <section key={key}>
                  <strong>{current?.label ?? previous?.label}</strong>
                  {previous?.language !== current?.language ? (
                    <p>
                      Syntax changed from {previous?.language ?? 'text'} to{' '}
                      {current?.language ?? 'text'}.
                    </p>
                  ) : null}
                  <pre>
                    {reviewLineDiff(previous?.text ?? '', current?.text ?? '').map(line =>
                      line.kind === 'removed' ? (
                        <del key={line.id}>
                          {line.text}
                          {'\n'}
                        </del>
                      ) : line.kind === 'added' ? (
                        <ins key={line.id}>
                          {line.text}
                          {'\n'}
                        </ins>
                      ) : (
                        <span key={line.id}>
                          {line.text}
                          {'\n'}
                        </span>
                      ),
                    )}
                  </pre>
                </section>
              ))}
              {changedReviewFields(item, record).length === 0 ? (
                <p>
                  No differences remain at this level. Review again to clear the changed marker.
                </p>
              ) : null}
            </div>
          ) : null}
        </details>
      ) : null}
    </div>
  )
}

export function ReviewableCode({
  itemId,
  label,
  children,
}: {
  itemId: string
  label?: string
  children: ReactNode
}) {
  const review = useWorkspaceReview()
  return (
    <div
      className='vp-reviewable-code'
      data-review-item={itemId}
      data-status={review.status(itemId)}
    >
      <ReviewControls key={itemId} itemId={itemId} label={label} />
      {children}
    </div>
  )
}
