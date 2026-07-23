// Firestore disabled — stub only
export type Firestore = never
export type DocumentData = Record<string, unknown>
export type DocumentSnapshot<T = DocumentData> = { id: string; data: () => T | undefined }

export function getDb(): never {
  throw new Error('Firestore is not configured')
}

export function enableOfflinePersistence(): Promise<void> {
  return Promise.resolve()
}

export function collection(): never {
  throw new Error('Firestore is not configured')
}

export function doc(): never {
  throw new Error('Firestore is not configured')
}

export const collections = {} as Record<string, () => never>
