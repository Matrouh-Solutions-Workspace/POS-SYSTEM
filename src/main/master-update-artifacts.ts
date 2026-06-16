import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'

const UPDATES_DIR_NAME = 'master-updates'
const LATEST_YML = 'latest.yml'

export interface UpdateArtifact {
  path: string
  fileName: string
  size: number
}

export function getMasterUpdatesDirectory(): string {
  return join(app.getPath('userData'), UPDATES_DIR_NAME)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function updateArtifactDirectories(): string[] {
  const exeDir = dirname(app.getPath('exe'))
  const dirs = [
    getMasterUpdatesDirectory(),
    join(exeDir, 'updates'),
    join(exeDir, 'release'),
    join(process.resourcesPath, 'updates')
  ]

  if (process.env['ELECTRON_RENDERER_URL']) {
    dirs.push(join(process.cwd(), 'release'))
  }

  return unique(dirs)
}

export function findUpdateArtifactDirectory(): string | null {
  return updateArtifactDirectories().find((dir) => existsSync(join(dir, LATEST_YML))) ?? null
}

export function readLatestUpdateYml(): { path: string; content: string } | null {
  const dir = findUpdateArtifactDirectory()
  if (!dir) return null
  const path = join(dir, LATEST_YML)
  return { path, content: readFileSync(path, 'utf8') }
}

export function resolveUpdateArtifact(fileName: string): UpdateArtifact | null {
  const dir = findUpdateArtifactDirectory()
  if (!dir) return null

  const safeName = basename(fileName)
  if (!safeName || safeName !== fileName) return null

  const root = resolve(dir)
  const target = resolve(root, safeName)
  if (target !== root && !target.startsWith(`${root}${sep}`)) return null
  if (!existsSync(target)) return null

  const stats = statSync(target)
  if (!stats.isFile()) return null

  return { path: target, fileName: safeName, size: stats.size }
}

function updateFileNameFrom(info: UpdateInfo, fallbackPath: string): string {
  const rawUrl = info.files?.[0]?.url
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl)
      const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '')
      if (name) return basename(name)
    } catch {
      const name = decodeURIComponent(rawUrl.split(/[?#]/)[0]?.split('/').pop() ?? '')
      if (name) return basename(name)
    }
  }

  return basename(fallbackPath)
}

function quoteYaml(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function buildLatestYml(info: UpdateInfo, fileName: string, size: number): string {
  const fileInfo = info.files?.[0]
  const sha512 = fileInfo?.sha512 ?? info.sha512
  if (!sha512) throw new Error('Downloaded update is missing sha512 metadata')

  return [
    `version: ${quoteYaml(info.version)}`,
    'files:',
    `  - url: ${quoteYaml(fileName)}`,
    `    sha512: ${quoteYaml(sha512)}`,
    `    size: ${size}`,
    `path: ${quoteYaml(fileName)}`,
    `sha512: ${quoteYaml(sha512)}`,
    `releaseDate: ${quoteYaml(info.releaseDate ?? new Date().toISOString())}`,
    ''
  ].join('\n')
}

export function publishDownloadedUpdateForMaster(event: UpdateDownloadedEvent): void {
  const source = event.downloadedFile
  if (!source || !existsSync(source)) {
    throw new Error('Downloaded update file is not available for LAN publishing')
  }

  const targetDir = getMasterUpdatesDirectory()
  mkdirSync(targetDir, { recursive: true })

  const fileName = updateFileNameFrom(event, source)
  const target = join(targetDir, fileName)
  if (resolve(source) !== resolve(target)) {
    copyFileSync(source, target)
  }

  const sourceBlockmap = `${source}.blockmap`
  if (existsSync(sourceBlockmap)) {
    copyFileSync(sourceBlockmap, `${target}.blockmap`)
  }

  const size = statSync(target).size
  writeFileSync(join(targetDir, LATEST_YML), buildLatestYml(event, fileName, size), 'utf8')
}
