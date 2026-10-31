import fs from 'node:fs'
import { playAudio, startBluetooth } from '../audio/index.js'
import { createTriggerGate, onTrigger } from '../pipeline.js'
import { fakeEvent } from '../stubs.js'
import { surviveErrors } from '../survive.js'

// The real chain on saved photos, with no Ring event: real Gemini, real voice, and real
// sound on the speaker. Usage: npm run try-chain -- first.jpg [later.jpg]
surviveErrors()
const files = process.argv.slice(2)
if (!files.length) throw new Error('Usage: npm run try-chain -- first.jpg [later.jpg]')
const frames = files.map((file, i) => ({ jpegBuffer: fs.readFileSync(file), takenAt: Date.now(), source: i ? 'closer' : 'uuid', takenAtKnown: true }))
await startBluetooth().pinOutput()
const event = fakeEvent()
const result = await onTrigger(event, {
  output: 'bluetooth',
  gate: createTriggerGate({ cooldownMs: 0 }),
  snapshot: async () => ({ ...frames.at(-1), frames }),
  storeSnapshot: null,
  play: playAudio,
  openSession: () => null,
})
const r = result.row
console.log(JSON.stringify({ status: result.status, decision: r.gemini_decision, source: r.comment_source, costume: r.costume_label, comment: r.comment_text, gemini_ms: r.gemini_ms, tts_ms: r.tts_ms, cover: r.cover_clip, audio: r.audio_path?.split('/').slice(-2).join('/'), error: r.error, first_audio: Date.parse(r.first_audio_at) - event.receivedAt, comment_at: Date.parse(r.comment_at) - event.receivedAt }, null, 1))
process.exit(result.status === 'played' ? 0 : 1)
