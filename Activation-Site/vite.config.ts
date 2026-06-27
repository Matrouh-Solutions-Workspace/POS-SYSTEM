import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  return {
    plugins: [react(), localApiPlugin()],
    server: {
      port: 5174
    }
  }
})

function localApiPlugin(): Plugin {
  return {
    name: 'shift-pos-local-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res, next) => {
        const path = new URL(req.url ?? '/', 'http://localhost').pathname
        const modulePath = apiModulePath(path)
        if (!modulePath) {
          next()
          return
        }

        try {
          const mod = await server.ssrLoadModule(modulePath) as {
            default?: (req: unknown, res: unknown) => Promise<void>
          }
          if (!mod.default) throw new Error(`Missing default export for ${modulePath}`)
          const body = await readRequestBody(req)
          await mod.default(
            {
              method: req.method,
              headers: req.headers,
              body
            },
            createVercelResponse(res)
          )
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : 'Local API failed'
          })
        }
      })
    }
  }
}

function apiModulePath(path: string): string | null {
  if (path === '/health') return '/api/health.ts'
  if (path === '/issue-license') return '/api/issue-license.ts'
  if (path === '/activations') return '/api/activations.ts'
  return null
}

async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return undefined
  const contentType = String(req.headers['content-type'] ?? '')
  if (!contentType.includes('application/json')) return raw
  return JSON.parse(raw)
}

function createVercelResponse(res: ServerResponse): {
  status(code: number): unknown
  json(value: unknown): void
  setHeader(name: string, value: string): void
  send(value: string): void
} {
  return {
    status(code: number) {
      res.statusCode = code
      return this
    },
    json(value: unknown) {
      sendJson(res, res.statusCode || 200, value)
    },
    setHeader(name: string, value: string) {
      res.setHeader(name, value)
    },
    send(value: string) {
      if (!res.headersSent) res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end(value)
    }
  }
}

function sendJson(res: ServerResponse, statusCode: number, value: unknown): void {
  if (res.writableEnded) return
  res.statusCode = statusCode
  if (!res.headersSent) res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}
