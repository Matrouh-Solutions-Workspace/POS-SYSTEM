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

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      shell: false,
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
    })
  })
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'

await run(npmCmd, ['run', 'build'])
await run(npxCmd, ['electron-builder', '--win', '--x64', '--publish', 'always'])
