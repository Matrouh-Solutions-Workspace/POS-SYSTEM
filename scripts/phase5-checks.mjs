import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Phase 5 check failed: ${message}`)
    process.exitCode = 1
  }
}

const packageJson = JSON.parse(read('package.json'))
const licenseTs = read('src/main/license.ts')
const mainIndex = read('src/main/index.ts')
const preload = read('src/preload/index.ts')
const authService = read('src/renderer/src/features/auth/auth-service.ts')
const localStore = read('src/main/local-store.ts')

assert(
  packageJson.scripts['dist:win']?.startsWith('npm run verify:phase5'),
  'dist:win must run verify:phase5 before packaging'
)
assert(
  packageJson.scripts['dist:win:publish']?.startsWith('npm run verify:phase5'),
  'dist:win:publish must run verify:phase5 before publishing'
)

assert(!/activateMasterKey|MASTER_KEY_HASH|dev-license-bypass|toggleDevLicense|isDevBypassActive/.test(licenseTs + mainIndex + preload), 'license bypass/master key code must not be present')
assert(!/subtle\.digest\('SHA-256'|passwordHash = await sha256|offlineAuth/.test(authService), 'renderer must not hash or cache passwords locally')
assert(/scryptSync/.test(localStore) && /PASSWORD_HASH_VERSION = 'scrypt\$v1'/.test(localStore), 'main process must use versioned scrypt password hashes')
assert(/SCHEMA_VERSION/.test(localStore) && /runMigrations/.test(localStore), 'local store must have a schema migration runner')

if (process.exitCode) process.exit(process.exitCode)
console.log('Phase 5 checks passed')
