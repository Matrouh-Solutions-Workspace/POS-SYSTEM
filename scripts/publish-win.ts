import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv } from './load-env'
import { CHANGELOG } from '../src/renderer/src/config/changelog'

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

interface PackageJson {
  version: string
  build?: {
    publish?: {
      owner?: string
      repo?: string
      vPrefixedTagName?: boolean
    }
  }
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as PackageJson
}

function buildReleaseNotes(version: string): { filePath: string; body: string } {
  const entry = CHANGELOG.find((item) => item.version === version)
  if (!entry) {
    throw new Error(`No CHANGELOG entry found for version ${version}`)
  }

  const typeLabel = {
    new: 'New',
    improve: 'Improved',
    fix: 'Fixed'
  } satisfies Record<string, string>

  const body = [
    `# SHIFT POS ${version}`,
    '',
    entry.date ? `Release date: ${entry.date}` : '',
    '',
    ...entry.changes.map((change) => `- **${typeLabel[change.type]}:** ${change.text}`),
    ''
  ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n')

  const notesDir = resolve(process.cwd(), '.release-notes')
  mkdirSync(notesDir, { recursive: true })
  const versionedPath = resolve(notesDir, `README-${version}.md`)
  const latestPath = resolve(notesDir, 'release-notes.md')
  writeFileSync(versionedPath, body, 'utf8')
  writeFileSync(latestPath, body, 'utf8')
  return { filePath: '.release-notes/release-notes.md', body }
}

async function updateGitHubReleaseNotes(packageJson: PackageJson, notes: string): Promise<void> {
  const publish = packageJson.build?.publish
  const owner = publish?.owner
  const repo = publish?.repo
  if (!owner || !repo) {
    console.warn('Skipping GitHub release notes update: build.publish.owner/repo are missing.')
    return
  }

  const tagPrefix = publish?.vPrefixedTagName === false ? '' : 'v'
  const tag = `${tagPrefix}${packageJson.version}`
  const token = process.env.GH_TOKEN!
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'SHIFT-POS-release-publisher',
    'X-GitHub-Api-Version': '2022-11-28'
  }

  const releaseResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`, { headers })
  if (!releaseResponse.ok) {
    const text = await releaseResponse.text()
    throw new Error(`Failed to load GitHub release ${tag}: ${releaseResponse.status} ${text}`)
  }
  const release = await releaseResponse.json() as { id: number }
  const updateResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${release.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ body: notes })
  })
  if (!updateResponse.ok) {
    const text = await updateResponse.text()
    throw new Error(`Failed to update GitHub release notes for ${tag}: ${updateResponse.status} ${text}`)
  }
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

const packageJson = readPackageJson()
const releaseNotes = buildReleaseNotes(packageJson.version)

await run('npm run build')
await run(`npx electron-builder --win --x64 --publish always -c.releaseInfo.releaseNotesFile=${releaseNotes.filePath}`)
await updateGitHubReleaseNotes(packageJson, releaseNotes.body)
