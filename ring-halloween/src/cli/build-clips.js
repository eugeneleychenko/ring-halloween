import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { CLIP_LINES } from '../clip-lines.js'
import { CLIPS_DIR, config } from '../config.js'
import { clipKey, synthesize, voiceRequest } from '../tts.js'

const { values: args } = parseArgs({ options: { force: { type: 'boolean', default: false } } })
const manifestFile = path.join(CLIPS_DIR, 'manifest.json')
const previous = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { categories: {} }
const keyOf = new Map(Object.values(previous.categories ?? {}).flat().map((clip) => [clip.file, clip.key]))
const fileName = (category, i, total) => (total === 1 ? `${category}.wav` : `${category}-${String(i + 1).padStart(2, '0')}.wav`)

const categories = {}
let generated = 0
let chars = 0
for (const [category, lines] of Object.entries(CLIP_LINES)) {
  categories[category] = []
  for (const [i, text] of lines.entries()) {
    const file = fileName(category, i, lines.length)
    const outputPath = path.join(CLIPS_DIR, file)
    const key = clipKey(text, config)
    // A changed line, voice or setting gives a new key, so stale clips get rebuilt.
    if (args.force || keyOf.get(file) !== key || !fs.existsSync(outputPath)) {
      await synthesize(text, { outputPath, useCache: false })
      generated++
      chars += text.length
      console.log(`  made ${file}: "${text}"`)
    }
    categories[category].push({ file, text, key })
  }
}
const { text: _text, ...request } = voiceRequest('', config)
fs.writeFileSync(manifestFile, JSON.stringify({
  builtAt: new Date().toISOString(),
  voiceId: config.elevenLabsVoiceId,
  request,
  normalize: { lufs: -14, truePeak: -1, highpassHz: config.ttsHighpassHz, presenceDb: config.ttsPresenceDb, leadingSilenceMs: config.ttsLeadingSilenceMs },
  categories,
}, null, 2) + '\n')
const total = Object.values(categories).flat().length
console.log(`${total} clips ready, ${generated} newly generated (${chars} characters). Manifest: ${manifestFile}`)
