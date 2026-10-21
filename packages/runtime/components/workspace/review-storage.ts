const databaseName = 'vp-workspace-reviews'
const storeName = 'reviews'

// Order reads with pending writes, including when a revised workspace remounts.
let pending: Promise<unknown> = Promise.resolve()
function ordered<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation)
  pending = result.catch(() => undefined)
  return result
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    let expired = false
    const timer = setTimeout(() => {
      expired = true
      reject(new Error('Review storage did not open. Close other plan tabs and retry.'))
    }, 10_000)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onerror = () => {
      clearTimeout(timer)
      reject(request.error)
    }
    request.onsuccess = () => {
      clearTimeout(timer)
      if (expired) request.result.close()
      else resolve(request.result)
    }
  })
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode)
      const request = operation(transaction.objectStore(storeName))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error ?? new Error('Review save aborted.'))
      transaction.onerror = () => reject(transaction.error ?? request.error)
    })
  } finally {
    database.close()
  }
}

/** Existing browser records are read only when this plan has no IndexedDB record yet. */
export function readSavedFeedback(key: string, legacyKey: string): Promise<string | null> {
  return ordered(async () => {
    const saved = await transact<string | undefined>('readonly', store => store.get(key))
    if (saved !== undefined) return saved
    return localStorage.getItem(key) ?? localStorage.getItem(legacyKey)
  })
}

/** Resolve only after the transaction commits, not when its put request succeeds. */
export function writeSavedFeedback(key: string, value: string): Promise<void> {
  return ordered(async () => {
    await transact('readwrite', store => store.put(value, key))
  })
}
