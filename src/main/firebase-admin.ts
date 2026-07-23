// Firebase Admin disabled — stub only
// All functions are no-ops or throw; cloud sync is handled via api-sync instead.

export async function deleteAuthUser(_uid: string): Promise<void> {
  throw new Error('Firebase Admin is not configured in this build')
}

export async function resetAuthUserPassword(_uid: string, _newPassword: string): Promise<void> {
  throw new Error('Firebase Admin is not configured in this build')
}

export async function ensureAuthUser(_params: {
  uid: string
  email: string
  password: string
  displayName: string
}): Promise<void> {
  throw new Error('Firebase Admin is not configured in this build')
}

export async function readAdminDocument(
  _collectionName: string,
  _documentId: string
): Promise<unknown | null> {
  return null
}

export async function writeAdminDocument(
  _collectionName: string,
  _documentId: string,
  _data: unknown
): Promise<void> {
  // no-op
}
