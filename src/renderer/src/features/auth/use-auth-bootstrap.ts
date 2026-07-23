/**
 * Forces a fresh login on app load.
 * Accounts stay stored, but the current user session is not resumed.
 */
import { useEffect } from 'react'
import { useAuthStore } from './auth-store'
import { clearSavedSession } from './auth-service'

export function useAuthBootstrap(): void {
  const setUser = useAuthStore((s) => s.setUser)
  const setLoading = useAuthStore((s) => s.setLoading)

  useEffect(() => {
    setLoading(true)
    clearSavedSession()
    setUser(null)
    setLoading(false)
  }, [setUser, setLoading])
}
