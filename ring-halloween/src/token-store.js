import fs from 'node:fs'
import path from 'node:path'
import { TOKEN_DIR } from './config.js'

// The Ring token rotates. A stale token still logs in but silently kills push
// events, so every update is written straight to disk, atomically and owner-only.
export function tokenPath(dir = TOKEN_DIR) {
  return path.join(dir, 'ring-token.json')
}

export function loadToken(dir = TOKEN_DIR) {
  const file = tokenPath(dir)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8')).refreshToken || null
}

export function saveToken(token, dir = TOKEN_DIR) {
  if (!token) throw new Error('Refusing to save an empty Ring token')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = tokenPath(dir)
  const tmp = `${file}.${process.pid}.tmp`
  const body = JSON.stringify({ refreshToken: token, updatedAt: new Date().toISOString() })
  fs.writeFileSync(tmp, body, { mode: 0o600 })
  fs.renameSync(tmp, file)
}

// Two processes sharing one token would rotate it under each other and leave one
// holding a stale token, which is the silent push failure above. Allow only one.
export function acquireLock(dir = TOKEN_DIR) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, '.ring.lock')
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 })
      let held = true
      const release = () => {
        if (!held) return
        held = false
        fs.rmSync(file, { force: true })
      }
      process.once('exit', release)
      return release
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = Number(fs.readFileSync(file, 'utf8'))
      if (owner && owner !== process.pid && isAlive(owner)) {
        throw new Error(
          `Another ring-halloween command (process ${owner}) is using the Ring token. ` +
            'Stop it first: two at once would break push events.',
        )
      }
      fs.rmSync(file, { force: true })
    }
  }
  throw new Error(`Could not lock ${file}`)
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}
