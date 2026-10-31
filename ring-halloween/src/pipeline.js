import { config, measurementPath } from './config.js'
import { appendCsvRow } from './csv.js'
import { endActiveSession, getOrOpenSession } from './live-session.js'
import { getFreshSnapshot, recordSnapshot } from './snapshot.js'
import { playAudio } from './audio/index.js'
import { pickClip as pickBankClip } from './clip-bank.js'
import { generateComment } from './gemini.js'
import { synthesize } from './tts.js'

export const RUN_COLUMNS = [
  'trigger_id', 'trigger_at', 'event_received_at', 'snapshot_at', 'snapshot_route', 'gemini_ms',
  'gemini_decision', 'tts_ms', 'output', 'session_open_ms', 'first_audio_at', 'success', 'error',
]
const iso = (ms) => (ms ? new Date(ms).toISOString() : '')

// Ring sends no motion events while a live call is open, so the next group is only
// seen once this one is over. The cooldown stops one group triggering twice.
export function createTriggerGate({ cooldownMs = config.cooldownMs, now = Date.now } = {}) {
  let busy = false
  let lastFinishedAt = -Infinity
  return {
    tryEnter() {
      if (busy) return { allowed: false, reason: 'busy' }
      if (now() - lastFinishedAt < cooldownMs) return { allowed: false, reason: 'cooldown' }
      busy = true
      return { allowed: true }
    },
    release() {
      busy = false
      lastFinishedAt = now()
    },
  }
}

const defaultGate = createTriggerGate()

/**
 * One visitor, start to finish, writing one row to measurements/runs.csv.
 * A doorbell call opens the instant the event arrives, alongside snapshot, then
 * Gemini, then TTS, which hides the 2-5 s session open behind the AI steps.
 * The dependencies can be replaced, which is how `npm run simulate` runs offline.
 */
export async function onTrigger(event, {
  output = config.output,
  camera = event.camera,
  gate = defaultGate,
  snapshot = getFreshSnapshot,
  storeSnapshot = recordSnapshot,
  comment = generateComment,
  speak = synthesize,
  play = playAudio,
  pickClip = pickBankClip,
  skipBehavior = config.skipBehavior,
  signOff = config.signOff,
  openSession = output === 'doorbell' ? () => getOrOpenSession(camera, { t0: event.receivedAt }) : () => null,
  log = console.log,
} = {}) {
  const row = {
    trigger_id: event.id,
    trigger_at: iso(event.triggeredAt ?? event.eventAt),
    event_received_at: iso(event.receivedAt),
    output,
    success: false,
  }
  const write = () => appendCsvRow(measurementPath('runs.csv'), RUN_COLUMNS, row)

  const entry = gate.tryEnter()
  if (!entry.allowed) {
    row.error = `suppressed: ${entry.reason}`
    write()
    log(`[trigger] ${event.id} suppressed: ${entry.reason}`)
    return { status: 'suppressed', row }
  }
  const session = openSession()
  const problems = []
  let status = 'failed'
  try {
    let image = null
    try {
      image = await snapshot(event, { camera })
      row.snapshot_at = iso(image.takenAt)
      row.snapshot_route = image.source ?? ''
      storeSnapshot?.(event, image)
    } catch (error) {
      problems.push(`snapshot: ${error.message}`)
      storeSnapshot?.(event, error)
    }
    const geminiStarted = Date.now()
    const { decision, comment: text } = await comment(image?.jpegBuffer ?? null)
    row.gemini_ms = Date.now() - geminiStarted
    row.gemini_decision = decision
    if (decision === 'SKIP') {
      if (skipBehavior === 'line') {
        const clip = pickClip('skip')
        if (clip) await play(clip, { output, camera })
      }
      status = 'skipped'
      row.success = true
      return { status, row }
    }
    const ttsStarted = Date.now()
    const wavPath = await speak(text)
    row.tts_ms = Date.now() - ttsStarted
    const played = await play(wavPath, { output, camera })
    row.first_audio_at = iso(played.firstAudioAt)
    if (signOff) {
      const clip = pickClip('signoff')
      if (clip) await play(clip, { output, camera })
    }
    row.success = true
    status = 'played'
    return { status, row, comment: text }
  } catch (error) {
    problems.push(error.message)
    return { status, row, error }
  } finally {
    if (session) {
      row.session_open_ms = session.marks.speaker_ready ?? ''
      endActiveSession('finished')
    }
    row.error = problems.join('; ')
    gate.release()
    write()
  }
}
