import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App'
import { LicenseActivationPage } from '@renderer/features/license/LicenseActivationPage'

export async function bootstrapApp(): Promise<void> {
  const rootEl = document.getElementById('root')!
  const root = createRoot(rootEl)

  // License check — must pass before the app loads
  const licenseStatus = await window.electronAPI.getLicenseStatus()
  if (!licenseStatus.valid) {
    root.render(
      <StrictMode>
        <LicenseActivationPage
          status={licenseStatus}
          onActivated={() => window.location.reload()}
        />
      </StrictMode>
    )
    return
  }

  // Listen for server-side revocation during the session
  const unsubRevoke = window.electronAPI.onLicenseRevoked((reason) => {
    unsubRevoke()
    console.warn('[license] Revoked mid-session:', reason)
    window.location.reload()
  })

  // SQLite is primary; optional cloud sync starts in the background.
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
