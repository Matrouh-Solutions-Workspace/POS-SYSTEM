// Firebase disabled — stub mapper
export type DocumentData = Record<string, unknown>
export type DocumentSnapshot<T = DocumentData> = { id: string; data: () => T | undefined }

export function mapDoc<T extends { id: string }>(
  snap: DocumentSnapshot<DocumentData>
): T {
  const data = snap.data() ?? {}
  return { ...data, id: snap.id } as T
}

export function stripId<T extends { id: string }>(
  data: T
): Omit<T, 'id'> {
  const { id: _id, ...rest } = data
  return rest
}
