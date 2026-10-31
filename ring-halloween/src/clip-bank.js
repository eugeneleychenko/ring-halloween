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

function loadManifest() {
  const file = path.join(CLIPS_DIR, 'manifest.json')
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

// The words of a bank clip, for the log.
export function clipText(clipPath, manifest = loadManifest()) {
  const file = path.basename(clipPath)
  return Object.values(manifest?.categories ?? {}).flat().find((clip) => clip.file === file)?.text ?? ''
}

let picker = null
export function pickClip(category) {
  if (!picker) {
    picker = createClipPicker(loadManifest())
  }
  return picker(category)
}
