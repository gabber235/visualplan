import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planWorkspaceSchema } from '@visualplan/core'
import { PlanWorkspace } from '../components/workspace/PlanWorkspace.js'
import { emptyFeedback, feedbackKey } from '../components/workspace/feedback.js'
import { codeReviewId, markReview, reviewItems } from '../components/workspace/review-state.js'
import { readSavedFeedback, writeSavedFeedback } from '../components/workspace/review-storage.js'

const model = planWorkspaceSchema.parse({
  decisions: [
    {
      id: 'owner',
      title: 'One owner',
      code: [{ id: 'policy', file: 'policy.ts', symbol: 'decide', proposed: 'return allow()' }],
    },
  ],
})
const key = feedbackKey(location.pathname)
const codeId = codeReviewId('owner', 'policy', 'proposed')

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('indexedDB', new IDBFactory())
  localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('IndexedDB review storage', () => {
  it('saves and restores snapshots even when local storage is full', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError')
    })
    const state = emptyFeedback()
    state.reviews = markReview(codeId, 'accepted', reviewItems(model), {})
    await writeSavedFeedback(key, JSON.stringify(state))
    expect(JSON.parse((await readSavedFeedback(key, 'legacy'))!)).toEqual(state)
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })

  it('reads an existing record once and prefers committed database state afterwards', async () => {
    localStorage.setItem(key, 'old review')
    expect(await readSavedFeedback(key, 'legacy')).toBe('old review')
    await writeSavedFeedback(key, 'new review')
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('unavailable')
    })
    expect(await readSavedFeedback(key, 'legacy')).toBe('new review')
  })

  it('orders rapid updates and a revision reload after pending writes', async () => {
    const first = writeSavedFeedback(key, 'first')
    const second = writeSavedFeedback(key, 'second')
    const reload = readSavedFeedback(key, 'legacy')
    await Promise.all([first, second])
    expect(await reload).toBe('second')
    expect(await readSavedFeedback('another plan', 'other legacy')).toBeNull()
  })

  it('reports an aborted transaction even when its put succeeded, then permits retry', async () => {
    const put = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      const request = put.call(this, value, key)
      request.addEventListener('success', () => this.transaction.abort())
      return request
    })
    await expect(writeSavedFeedback(key, 'unsaved')).rejects.toThrow('aborted')
    spy.mockRestore()
    expect(await readSavedFeedback(key, 'legacy')).toBeNull()
    await writeSavedFeedback(key, 'retried')
    expect(await readSavedFeedback(key, 'legacy')).toBe('retried')
  })
})

describe('Review persistence through the rendered workspace', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })
  async function settled() {
    for (let attempt = 0; attempt < 100; attempt++) {
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 2))
      })
      if (container.querySelector('.vp-workspace[aria-busy="false"]')) return
    }
    throw new Error('Review persistence did not settle')
  }
  const status = () => container.querySelector('.vp-code-contract .vp-review-status')?.textContent

  it('retains approval through reload and marks a regenerated change despite full local storage', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError')
    })
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await settled()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.vp-item-review [data-action="accept"]')!.click(),
    )
    await settled()
    await act(async () => root.render(<PlanWorkspace key='reload' model={model} />))
    await settled()
    expect(status()).toBe('Accepted')
    const revised = structuredClone(model)
    revised.decisions[0]!.code[0]!.proposed = 'return deny()'
    await act(async () => root.render(<PlanWorkspace key='regenerated' model={revised} />))
    await settled()
    expect(status()).toBe('Changed')
    await act(async () => {
      const details = container.querySelector<HTMLDetailsElement>('.vp-item-review details')!
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(container.querySelector('del')?.textContent).toContain('return allow()')
    expect(container.querySelector('ins')?.textContent).toContain('return deny()')
    await act(async () => root.render(<PlanWorkspace key='reload-again' model={revised} />))
    await settled()
    expect(status()).toBe('Changed')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows a save failure, provides a complete backup, and saves the same approval on retry', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await settled()
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Disk is full', 'QuotaExceededError')
    })
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.vp-item-review [data-action="accept"]')!.click(),
    )
    await settled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('QuotaExceededError')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Download review backup',
    )
    let backup: Blob | undefined
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL(blob: Blob) {
          backup = blob
          return 'blob:review-backup'
        }
        static revokeObjectURL() {}
      },
    )
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await act(async () => {
      const buttons = container.querySelectorAll<HTMLButtonElement>('[role="alert"] button')
      buttons[1]!.click()
    })
    const packet = await new Promise<string>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsText(backup!)
    })
    expect(JSON.parse(packet).state.reviews[codeId].status).toBe('accepted')
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    spy.mockRestore()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
    )
    await settled()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    const saved = JSON.parse((await readSavedFeedback(key, 'legacy'))!)
    expect(saved.reviews[codeId].status).toBe('accepted')
  })

  it('keeps a corrupt saved record intact and makes the restoration failure visible', async () => {
    await writeSavedFeedback(key, 'corrupt review')
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await settled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Saved feedback is unavailable',
    )
    expect(await readSavedFeedback(key, 'legacy')).toBe('corrupt review')
  })
})
