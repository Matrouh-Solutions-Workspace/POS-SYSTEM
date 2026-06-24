/**
 * Restores the user session from SQLite on app load.
 * The session is stored locally.
 */
import { useEffect } from 'react'
import { useAuthStore } from './auth-store'
import { restoreSessionFromLocal } from './auth-service'

export function useAuthBootstrap(): void {
  const setUser = useAuthStore((s) => s.setUser)
  const setLoading = useAuthStore((s) => s.setLoading)

  useEffect(() => {
    setLoading(true)

    restoreSessionFromLocal()
      .then((user) => {
        setUser(user)
      })
      .catch((e) => {
        console.error('[auth bootstrap] session restore failed:', e)
        setUser(null)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [setUser, setLoading])
}
