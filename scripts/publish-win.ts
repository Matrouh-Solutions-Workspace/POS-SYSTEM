import { spawn } from 'node:child_process'
import { loadEnv } from './load-env'

loadEnv()

if (!process.env.GH_TOKEN && process.env.GITHUB_TOKEN) {
  process.env.GH_TOKEN = process.env.GITHUB_TOKEN
}

if (!process.env.GH_TOKEN) {
  console.error([
    'GitHub publish token is missing.',
    '',
    'Add it to .env.local as:',
    'GH_TOKEN=github_pat_...',
    '',
    'The token needs access to create releases and upload release assets for the repo.'
  ].join('\n'))
  process.exit(1)
}

function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value == null) continue
    if (key.includes('\0') || value.includes('\0')) continue
    next[key] = value
  }
  return next
}

async function run(command: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [], {
      env: cleanEnv(process.env),
      shell: true,
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}`))
    })
  })
}

await run('npm run build')
await run('npx electron-builder --win --x64 --publish always')
