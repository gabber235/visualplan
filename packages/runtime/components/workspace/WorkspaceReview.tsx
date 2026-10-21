import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { IconMessagePlus, IconX, IconCopy, IconCheck } from '@tabler/icons-react'
import { copyText } from '../ShareButton.js'
import {
  captureTarget,
  emptyFeedback,
  exportFeedback,
  feedbackKey,
  legacyFeedbackKey,
  migrateFeedback,
  feedbackSchema,
  type FeedbackComment,
  type FeedbackState,
  type FeedbackTarget,
  workspaceRevision,
} from './feedback.js'
import {
  summarizeReview,
  markReview,
  type ReviewSummary,
  reconcileReviews,
  reviewItems,
  type ReviewItem,
  type ReviewStatus,
} from './review-state.js'
import type { WorkspaceModel } from './model.js'
import { reconcileFeedback, snapshotTarget, targetChanged } from './feedback-targets.js'
import { readSavedFeedback, writeSavedFeedback } from './review-storage.js'
import './feedback.css'

interface ReviewActions {
  state: FeedbackState
  items: Map<string, ReviewItem>
  summary: (id: string) => ReviewSummary
  status: (id: string) => ReviewStatus
  setStatus: (id: string, status: ReviewStatus) => void
}
const ReviewContext = createContext<ReviewActions | null>(null)
export function useWorkspaceReview(): ReviewActions {
  const value = useContext(ReviewContext)
  if (!value) throw new Error('Workspace review requires its owner')
  return value
}

async function loadFeedback(
  key: string,
  model: WorkspaceModel,
  items: Map<string, ReviewItem>,
  pathname: string,
) {
  try {
    const saved = await readSavedFeedback(key, legacyFeedbackKey(model, pathname))
    const value = saved ? JSON.parse(saved) : null
    const state = value
      ? value.version === 1
        ? migrateFeedback(value, model)
        : feedbackSchema.parse(value)
      : emptyFeedback()
    const reconciled = reconcileFeedback(model, state)
    const revision = workspaceRevision(model)
    return {
      state: {
        ...reconciled,
        comments: reconciled.comments.filter(comment => (comment.sent ?? revision) === revision),
        reviews: reconcileReviews(items, state.reviews),
      },
      writable: true,
      warning: '',
    }
  } catch {
    return {
      state: emptyFeedback(),
      writable: false,
      warning:
        'Saved feedback is unavailable. Copy this session before closing; existing storage will not be overwritten.',
    }
  }
}

export function WorkspaceReview({
  model,
  children,
}: {
  model: WorkspaceModel
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const pathname = typeof location === 'undefined' ? '' : location.pathname
  const items = useMemo(() => reviewItems(model), [model])
  const key = useMemo(() => feedbackKey(pathname), [pathname])
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof loadFeedback>>>()
  const [state, setState] = useState(emptyFeedback)
  const [warning, setWarning] = useState('')
  const [saving, setSaving] = useState(false)
  const [panel, setPanel] = useState<'closed' | 'draft' | 'comments' | 'export'>('closed')
  const [picking, setPicking] = useState(false)
  const [targets, setTargets] = useState<FeedbackTarget[]>([])
  const [selection, setSelection] = useState<FeedbackTarget>()
  const [removed, setRemoved] = useState<FeedbackComment>()
  const [copyStatus, setCopyStatus] = useState('')
  const [draftNotice, setDraftNotice] = useState('')

  useEffect(() => {
    let current = true
    void loadFeedback(key, model, items, pathname).then(result => {
      if (!current) return
      setState(result.state)
      setWarning(result.warning)
      setPanel(result.state.draft ? 'draft' : 'closed')
      setLoaded(result)
    })
    return () => {
      current = false
    }
  }, [key, model, items, pathname])

  useEffect(() => {
    if (!loaded?.writable) return
    let current = true
    setSaving(true)
    void writeSavedFeedback(key, JSON.stringify(state)).then(
      () => {
        if (current) {
          setSaving(false)
          setWarning('')
        }
      },
      error => {
        if (!current) return
        setSaving(false)
        const detail =
          error instanceof Error || error instanceof DOMException
            ? ` ${error.name}: ${error.message}`
            : ''
        setWarning(
          `Reviews are not saved. Keep this page open, retry saving, or download a review backup.${detail}`,
        )
      },
    )
    return () => {
      current = false
    }
  }, [state, key, loaded])

  useEffect(() => {
    if (!saving && !warning) return
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protectUnsaved)
    return () => window.removeEventListener('beforeunload', protectUnsaved)
  }, [saving, warning])

  const downloadBackup = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ key, state })], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'plan-review-backup.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Other fixed chrome (the iteration diff chip) reads this clearance to stay above the bar.
  useEffect(() => {
    const element = bar.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const style = document.documentElement.style
    const observer = new ResizeObserver(() =>
      style.setProperty('--vp-feedback-bar-clearance', `${element.offsetHeight + 20}px`),
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
      style.removeProperty('--vp-feedback-bar-clearance')
    }
  }, [])

  useEffect(() => {
    const current = dialog.current
    if (!current) return
    if (panel !== 'closed' && !current.open) current.showModal?.()
    else if (panel === 'closed' && current.open) current.close?.()
    if (panel === 'draft') current.querySelector('textarea')?.focus()
  }, [panel])

  useEffect(() => {
    const readSelection = () => {
      const selected = window.getSelection()
      const element = root.current
      if (!element || !selected || selected.isCollapsed || !selected.rangeCount) {
        setSelection(undefined)
        return
      }
      const range = selected.getRangeAt(0)
      const ancestor = range.commonAncestorContainer
      const node = ancestor instanceof Element ? ancestor : ancestor.parentElement
      if (!node || !element.contains(node) || node.closest('[data-review-ui]')) {
        setSelection(undefined)
        return
      }
      setSelection(snapshotTarget(model, captureTarget(node, element, range)))
    }
    document.addEventListener('selectionchange', readSelection)
    return () => document.removeEventListener('selectionchange', readSelection)
  }, [model])

  const requestComment = (target: FeedbackTarget, existing?: FeedbackComment) => {
    setDraftNotice(
      state.draft
        ? 'You have an unfinished draft. Save or discard it before starting another comment.'
        : '',
    )
    if (!state.draft)
      setState(current => ({
        ...current,
        draft: {
          target: {
            ...snapshotTarget(model, target),
            revision: existing?.target.revision ?? workspaceRevision(model),
          },
          body: existing?.body ?? '',
          ...(existing ? { editId: existing.id } : {}),
        },
      }))
    setPanel('draft')
    setPicking(false)
    window.getSelection()?.removeAllRanges()
  }
  const actions: ReviewActions = {
    state,
    items,
    summary: id => summarizeReview(id, items, state.reviews),
    status: id => summarizeReview(id, items, state.reviews).status,
    setStatus: (id, status) => {
      if (!loaded) return
      setState(current => ({
        ...current,
        reviews: markReview(id, status, items, current.reviews),
      }))
    },
  }
  const saveComment = () => {
    const draft = state.draft
    if (!draft?.body.trim() || draft.target.stale || targetChanged(model, draft.target)) return
    const comment: FeedbackComment = {
      id:
        draft.editId ??
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      target: draft.target,
      body: draft.body,
    }
    setState(current => ({
      ...current,
      draft: undefined,
      comments: draft.editId
        ? current.comments.map(item => (item.id === draft.editId ? comment : item))
        : [...current.comments, comment],
    }))
    setPanel('closed')
  }
  const closePanel = () => {
    if (state.draft && !state.draft.body.trim())
      setState(current => ({ ...current, draft: undefined }))
    setPanel('closed')
  }
  const removeComment = (comment: FeedbackComment) => {
    setRemoved(comment)
    setState(current => {
      const comments = current.comments.filter(item => item.id !== comment.id)
      return { ...current, comments }
    })
  }
  const startPicking = () => {
    const element = root.current
    if (!element) return
    const visibleTargets = [...element.querySelectorAll<HTMLElement>('[data-review-id]')]
      .filter(
        item =>
          item.getClientRects().length > 0 &&
          !item.closest('[hidden]') &&
          !item.closest('details:not([open])'),
      )
      .map(item => snapshotTarget(model, captureTarget(item, element)))
    setTargets([
      ...new Map(visibleTargets.map(target => [JSON.stringify(target.path), target])).values(),
    ])
    setPicking(current => !current)
  }
  const title =
    typeof document === 'undefined'
      ? 'Interactive plan'
      : (document.querySelector('h1')?.textContent ?? 'Interactive plan')
  const exported = useMemo(
    () =>
      panel === 'export'
        ? exportFeedback(
            model,
            state,
            title,
            (globalThis as typeof globalThis & { __VP_SOURCE__?: string }).__VP_SOURCE__,
          )
        : '',
    [model, state, title, panel],
  )
  const draft = state.draft
  const markSent = () => {
    const revision = workspaceRevision(model)
    setState(current => ({
      ...current,
      comments: current.comments.map(comment => ({ ...comment, sent: revision })),
    }))
  }

  return (
    <ReviewContext.Provider value={actions}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Delegates review gestures; the toolbar also provides keyboard target selection. */}
      <div
        className='vp-workspace'
        aria-busy={!loaded || saving}
        ref={root}
        data-picking={picking}
        onClickCapture={event => {
          if (
            !picking ||
            !(event.target instanceof Element) ||
            event.target.closest('[data-review-ui]')
          )
            return
          const element = event.target.closest('[data-review-id]')
          if (!element || !root.current) return
          event.preventDefault()
          event.stopPropagation()
          requestComment(snapshotTarget(model, captureTarget(element, root.current)))
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') setPicking(false)
        }}
      >
        {warning ? (
          <aside className='vp-review-save-warning' role='alert' data-review-ui='true'>
            <strong>{warning}</strong>
            {loaded?.writable ? (
              <button type='button' onClick={() => setState(current => ({ ...current }))}>
                Retry saving
              </button>
            ) : null}
            <button type='button' onClick={downloadBackup}>
              Download review backup
            </button>
          </aside>
        ) : null}
        {!loaded ? <p role='status'>Loading saved reviews…</p> : null}
        <div inert={!loaded}>{children}</div>
        <section
          className='vp-feedback-bar'
          ref={bar}
          data-review-ui='true'
          aria-label='Plan feedback'
        >
          <div className='vp-feedback-bar__actions' inert={!loaded}>
            <button type='button' onClick={() => setPanel('comments')}>
              <IconMessagePlus size={16} />
              Feedback <span>{state.comments.length}</span>
            </button>
            {selection ? (
              <button
                type='button'
                className='vp-feedback-primary'
                onPointerDown={event => event.preventDefault()}
                onClick={() => requestComment(selection)}
              >
                Comment on selection
              </button>
            ) : (
              <button
                type='button'
                className='vp-feedback-primary'
                aria-label={picking ? 'Cancel picking' : 'Comment on an item'}
                aria-pressed={picking}
                onClick={startPicking}
              >
                {picking ? 'Cancel picking' : 'Comment'}
              </button>
            )}
            {draft && panel !== 'draft' ? (
              <button type='button' onClick={() => setPanel('draft')}>
                Resume draft
              </button>
            ) : null}
            <button
              type='button'
              aria-label='Export feedback'
              onClick={() => {
                setCopyStatus('')
                setPanel('export')
              }}
            >
              <IconCopy size={16} />
              Export
            </button>
          </div>
          {picking ? (
            <div className='vp-feedback-pick'>
              <span>Tap an outlined item, or choose a target. Escape cancels.</span>
              <select
                aria-label='Feedback target'
                value=''
                onChange={event => {
                  const target = targets[Number(event.target.value)]
                  if (target) requestComment(target)
                }}
              >
                <option value='' disabled>
                  Choose a specific target
                </option>
                {targets.map((target, index) => (
                  <option key={JSON.stringify(target.path)} value={index}>
                    {target.labels.join(' / ')}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {saving ? <small role='status'>Saving reviews…</small> : null}
        </section>

        <dialog
          ref={dialog}
          className='vp-feedback-dialog'
          data-review-ui='true'
          aria-label={
            panel === 'draft'
              ? 'Write feedback'
              : panel === 'export'
                ? 'Export feedback'
                : 'Review feedback'
          }
          onCancel={event => {
            event.preventDefault()
            closePanel()
          }}
        >
          <header>
            <h3>
              {panel === 'draft'
                ? 'Comment on this part'
                : panel === 'export'
                  ? 'Send feedback to your agent'
                  : 'Your feedback'}
            </h3>
            <button type='button' aria-label='Close feedback' onClick={closePanel}>
              <IconX size={18} />
            </button>
          </header>
          {panel === 'draft' && draft ? (
            <form
              onSubmit={event => {
                event.preventDefault()
                saveComment()
              }}
            >
              <p className='vp-feedback-location'>{draft.target.labels.join(' / ')}</p>
              {draftNotice ? <p role='status'>{draftNotice}</p> : null}
              {draft.target.stale ? (
                <p role='alert'>
                  This draft refers to content that changed or was removed. Copy your text, then
                  discard this draft and choose the current target.
                </p>
              ) : null}
              <blockquote>{draft.target.quote ?? draft.target.excerpt}</blockquote>
              <label>
                Your feedback
                <textarea
                  rows={5}
                  value={draft.body}
                  placeholder='Ask, object, or request a change. The quoted context is included.'
                  onChange={event =>
                    setState(current => ({
                      ...current,
                      draft: { ...draft, body: event.target.value },
                    }))
                  }
                  onKeyDown={event => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault()
                      saveComment()
                    }
                  }}
                />
              </label>
              <footer>
                <button
                  type='button'
                  onClick={() => {
                    setState(current => ({ ...current, draft: undefined }))
                    setPanel('closed')
                  }}
                >
                  Discard draft
                </button>
                <button type='button' onClick={() => setPanel('closed')}>
                  Keep draft
                </button>
                <button
                  type='submit'
                  className='vp-feedback-primary'
                  disabled={!draft.body.trim() || draft.target.stale}
                >
                  {draft.editId ? 'Save changes' : 'Save comment'}
                </button>
              </footer>
            </form>
          ) : null}
          {panel === 'comments' ? (
            <div className='vp-feedback-list'>
              {state.comments.length === 0 ? (
                <p>Select text, or choose Comment and click an item.</p>
              ) : null}
              {state.comments.map(comment => (
                <article key={comment.id}>
                  {comment.sent ? <small>Sent</small> : null}
                  <strong>{comment.target.labels.join(' / ')}</strong>
                  {comment.target.quote ? <blockquote>{comment.target.quote}</blockquote> : null}
                  <p>{comment.body}</p>
                  <div>
                    <button type='button' onClick={() => requestComment(comment.target, comment)}>
                      Edit
                    </button>
                    <button type='button' onClick={() => removeComment(comment)}>
                      Remove
                    </button>
                  </div>
                </article>
              ))}
              {removed ? (
                <button
                  type='button'
                  onClick={() => {
                    setState(current => ({
                      ...current,
                      comments: [...current.comments, removed],
                    }))
                    setRemoved(undefined)
                  }}
                >
                  Undo removal
                </button>
              ) : null}
            </div>
          ) : null}
          {panel === 'export' ? (
            <div className='vp-feedback-export'>
              {state.draft ? (
                <p role='alert'>
                  You have an unfinished draft. Save it before exporting if you want it included.
                </p>
              ) : null}
              <textarea
                aria-label='Feedback packet'
                readOnly
                rows={14}
                value={exported}
                onFocus={event => event.currentTarget.select()}
                onCopy={markSent}
              />
              <footer>
                <span role='status'>{copyStatus}</span>
                <button
                  type='button'
                  className='vp-feedback-primary'
                  onClick={async () => {
                    const copied = await copyText(exported)
                    if (copied) markSent()
                    setCopyStatus(
                      copied
                        ? 'Copied. These comments clear when the revised plan loads.'
                        : 'Clipboard unavailable. Select the packet above and copy it manually.',
                    )
                  }}
                >
                  <IconCheck size={16} />
                  Copy feedback
                </button>
              </footer>
            </div>
          ) : null}
        </dialog>
      </div>
    </ReviewContext.Provider>
  )
}
