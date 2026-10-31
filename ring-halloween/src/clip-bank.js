import fs from 'node:fs'
import path from 'node:path'
import { CLIPS_DIR } from './config.js'

// Random pick per category, never the same clip twice in a row.
export function createClipPicker(manifest, { dir = CLIPS_DIR, random = Math.random } = {}) {
  const last = new Map()
  return function pick(category) {
    const clips = manifest?.categories?.[category]
    if (!clips?.length) return null
    const options = clips.length > 1 ? clips.filter((clip) => clip.file !== last.get(category)) : clips
    const chosen = options[Math.floor(random() * options.length)]
    last.set(category, chosen.file)
    return path.join(dir, chosen.file)
  }
}

let picker = null
export function pickClip(category) {
  if (!picker) {
    const file = path.join(CLIPS_DIR, 'manifest.json')
    picker = createClipPicker(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null)
  }
  return picker(category)
}
