import path from 'node:path'
import { ASSETS_DIR } from './config.js'

// STUB until issue #08. Keep this signature.
export async function synthesize(_text) {
  return path.join(ASSETS_DIR, 'test-clip.wav')
}
