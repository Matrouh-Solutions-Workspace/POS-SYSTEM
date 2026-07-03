import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadEnv } from './load-env'

loadEnv()

const token = process.env.GH_TOKEN?.trim()
  || process.env.GITHUB_TOKEN?.trim()
  || process.env.SHIFT_POS_UPDATE_TOKEN?.trim()

if (!token) {
  console.error([
    'Updater token is missing.',
    '',
    'Private GitHub updates need a token bundled by the installer.',
    'Add one to .env.local or the build environment as:',
    'GH_TOKEN=github_pat_...',
    '',
    'Use a fine-grained token with read-only access to release assets.'
  ].join('\n'))
  process.exit(1)
}

function escapeNsisDefine(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '$\\"')
    .replace(/\r?\n/g, '')
}

const outputPath = resolve(process.cwd(), 'build/updater-token.generated.nsh')
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(
  outputPath,
  `!define SHIFT_POS_INSTALL_UPDATE_TOKEN "${escapeNsisDefine(token)}"\n`,
  'utf8'
)

console.log('Prepared installer updater token include.')
