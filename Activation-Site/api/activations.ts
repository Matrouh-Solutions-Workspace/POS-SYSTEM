import {
  assertPassword,
  handleApiError,
  requirePost,
  supabaseSelect,
  type VercelRequest,
  type VercelResponse
} from './_shared.js'

interface ActivationRow {
  license_id: string
  app_id: string
  app_version: string | null
  hwid: string
  machine_platform: string | null
  machine_hostname: string | null
  customer_name: string | null
  store_name: string | null
  issued_at: string
  expires_at: string | null
  created_at: string
}

interface EventRow {
  event_type: string
  created_at: string
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requirePost(req)
    const body = req.body as { password?: string }
    assertPassword(body.password)

    const activations = await supabaseSelect<ActivationRow>(
      'license_activations?select=license_id,app_id,app_version,hwid,machine_platform,machine_hostname,customer_name,store_name,issued_at,expires_at,created_at&order=created_at.desc&limit=100'
    )
    const events = await supabaseSelect<EventRow>(
      'activation_site_events?select=event_type,created_at&order=created_at.desc&limit=250'
    )
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    res.status(200).json({
      ok: true,
      activations,
      stats: {
        totalActivations: activations.length,
        issuedToday: activations.filter((row) => new Date(row.created_at) >= today).length,
        uniqueDevices: new Set(activations.map((row) => row.hwid)).size,
        totalEvents: events.length
      }
    })
  } catch (error) {
    handleApiError(res, error)
  }
}
