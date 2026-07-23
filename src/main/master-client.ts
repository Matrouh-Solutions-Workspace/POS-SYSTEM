import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readSideConnection, type SideConnectionConfig } from './network-config'

export interface MasterResponse<T> {
  ok: boolean
  data?: T
  error?: string
}

function requestJson<T>(
  config: SideConnectionConfig,
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, config.masterUrl)
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    const headers: Record<string, string> = {
      Accept: 'application/json'
    }
    if (body) headers['Content-Type'] = 'application/json'
    if (body) headers['Content-Length'] = String(Buffer.byteLength(body))
    if (options.auth !== false) headers.Authorization = `Bearer ${config.pairingToken}`

    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = requestFn(
      url,
      {
        method: options.method ?? (body ? 'POST' : 'GET'),
        headers,
        timeout: 8_000
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { raw += chunk })
        res.on('end', () => {
          try {
            const parsed = raw ? JSON.parse(raw) as MasterResponse<T> : { ok: false, error: 'Empty response' }
            if (!parsed.ok) {
              reject(new Error(parsed.error ?? `Master request failed (${res.statusCode})`))
              return
            }
            resolve(parsed.data as T)
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error('Master connection timed out'))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function sideConfigOrThrow(): SideConnectionConfig {
  const config = readSideConnection()
  if (!config) throw new Error('الجهاز الفرعي غير مقترن بجهاز ماستر')
  return config
}

export async function callMaster<T>(
  path: string,
  body?: unknown,
  options: { auth?: boolean; method?: 'GET' | 'POST' } = {}
): Promise<T> {
  return requestJson<T>(sideConfigOrThrow(), path, { ...options, body })
}

export async function callMasterWithConfig<T>(
  config: SideConnectionConfig,
  path: string,
  body?: unknown,
  options: { auth?: boolean; method?: 'GET' | 'POST' } = {}
): Promise<T> {
  return requestJson<T>(config, path, { ...options, body })
}
