import fs from 'node:fs'
import { measurementPath } from './config.js'

/**
 * Nobody is home on the night, so one bad event must never end the evening. Stray
 * errors are logged and the program carries on. If it truly dies, bin/keep-running
 * starts it again.
 */
export function surviveErrors({ file = measurementPath('errors.log'), target = process, log = console.error } = {}) {
  const record = (kind) => (error) => {
    const line = `${new Date().toISOString()} ${kind} ${error?.stack ?? error}\n`
    try {
      fs.appendFileSync(file, line)
    } catch {
      // Logging must never be the thing that takes the program down.
    }
    log(`[survived] ${kind}: ${error?.message ?? error}`)
  }
  target.on('uncaughtException', record('uncaughtException'))
  target.on('unhandledRejection', record('unhandledRejection'))
}
