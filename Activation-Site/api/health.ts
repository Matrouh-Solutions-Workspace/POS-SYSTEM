import { activationStorageMode, handleApiError, type VercelRequest, type VercelResponse } from './_shared.js'

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    res.status(200).json({
      ok: true,
      service: 'shift-pos-activation-site',
      storageMode: activationStorageMode(),
      env: {
        adminPassword: Boolean(process.env.ADMIN_PASSWORD),
        licensePrivateKey: Boolean(process.env.LICENSE_PRIVATE_KEY),
        supabaseUrl: Boolean(process.env.SUPABASE_URL),
        supabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
      }
    })
  } catch (error) {
    handleApiError(res, error)
  }
}
