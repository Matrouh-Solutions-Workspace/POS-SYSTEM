import {
  assertPassword,
  handleApiError,
  issueLicense,
  parseActivationRequest,
  requestMeta,
  requirePost,
  supabaseInsert,
  type VercelRequest,
  type VercelResponse
} from './_shared.js'

interface IssueLicenseBody {
  password?: string
  activationRequestText?: string
  customerName?: string
  storeName?: string
  days?: number | string
  features?: string[]
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    requirePost(req)
    const body = req.body as IssueLicenseBody
    assertPassword(body.password)
    const activationRequest = parseActivationRequest(body.activationRequestText ?? '')
    const days = body.days === '' || body.days === undefined ? undefined : Number(body.days)
    if (days !== undefined && (!Number.isFinite(days) || days <= 0)) {
      throw Object.assign(new Error('Expiration days must be a positive number'), { statusCode: 400 })
    }

    const issued = issueLicense({
      request: activationRequest,
      customerName: body.customerName,
      storeName: body.storeName,
      days,
      features: body.features
    })
    const meta = requestMeta(req)

    await supabaseInsert('license_activations', [{
      license_id: issued.payload.licenseId,
      app_id: issued.payload.appId,
      app_version: activationRequest.appVersion ?? null,
      hwid: issued.payload.hwid,
      machine_platform: activationRequest.machine?.platform ?? null,
      machine_hostname: activationRequest.machine?.hostname ?? null,
      request_nonce: activationRequest.nonce ?? null,
      request_created_at: activationRequest.createdAt ? new Date(activationRequest.createdAt).toISOString() : null,
      customer_name: issued.payload.customerName ?? null,
      store_name: issued.payload.storeName ?? null,
      features: issued.payload.features ?? ['offline-pos'],
      issued_at: new Date(issued.payload.issuedAt).toISOString(),
      expires_at: issued.payload.expiresAt ? new Date(issued.payload.expiresAt).toISOString() : null,
      requester_ip: meta.ip,
      user_agent: meta.userAgent
    }])

    await supabaseInsert('activation_site_events', [{
      event_type: 'license_issued',
      license_id: issued.payload.licenseId,
      hwid: issued.payload.hwid,
      metadata: {
        appId: issued.payload.appId,
        customerName: issued.payload.customerName,
        storeName: issued.payload.storeName
      },
      requester_ip: meta.ip,
      user_agent: meta.userAgent
    }])

    res.status(200).json({
      ok: true,
      license: {
        payload: issued.payload,
        signature: issued.signature
      },
      licenseText: issued.licenseText,
      fileName: `license-${issued.payload.licenseId}.dat`
    })
  } catch (error) {
    handleApiError(res, error)
  }
}
