// Firebase Auth disabled — stub only
export const auth: never = null as never
export type User = never

export function signInWithEmailAndPassword(): never {
  throw new Error('Firebase Auth is not configured')
}

export function signOut(): never {
  throw new Error('Firebase Auth is not configured')
}

export function onAuthStateChanged(): never {
  throw new Error('Firebase Auth is not configured')
}
