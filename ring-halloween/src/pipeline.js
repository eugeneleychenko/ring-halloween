import path from 'node:path'
import { config, measurementPath } from './config.js'
import { appendCsvRow } from './csv.js'
import { endActiveSession, getOrOpenSession } from './live-session.js'
import { getVisitorFrames, recordSnapshot } from './snapshot.js'
import { playAudio } from './audio/index.js'
import { clipText, pickClip as pickBankClip } from './clip-bank.js'
import { generateComment } from './gemini.js'
import { synthesize } from './tts.js'

export const RUN_COLUMNS = [
  'trigger_id', 'trigger_at', 'event_received_at', 'snapshot_at', 'snapshot_route', 'gemini_ms',
  'gemini_decision', 'tts_ms', 'output', 'session_open_ms', 'first_audio_at', 'success', 'error',
  'snapshot_path', 'costume_label', 'comment_text', 'audio_path',
  'cover_clip', 'comment_source', 'comment_at',
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
  snapshot = getVisitorFrames,
  storeSnapshot = recordSnapshot,
  comment = generateComment,
  speak = synthesize,
  play = playAudio,
  pickClip = pickBankClip,
  coverClip = config.coverClip,
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
  // Nothing here may wait on the cover clip: it starts now, and the output's queue
  // guarantees the comment follows it with no overlap.
  const cover = coverClip ? pickClip(event.type === 'ding' ? 'press' : 'cover') : null
  const coverPlay = cover
    ? Promise.resolve().then(() => play(cover, { output, camera })).catch((error) => {
      problems.push(`cover: ${error.message}`)
      return null
    })
    : Promise.resolve(null)
  row.cover_clip = cover ? path.basename(cover) : ''
  try {
    let image = null
    try {
      image = await snapshot(event, { camera })
      row.snapshot_at = iso(image.takenAt)
      row.snapshot_route = image.source ?? ''
      const paths = (image.frames ?? [image]).map((frame) => storeSnapshot?.(event, frame) ?? '')
      row.snapshot_path = paths.at(-1)
    } catch (error) {
      problems.push(`snapshot: ${error.message}`)
      storeSnapshot?.(event, error)
    }
    const geminiStarted = Date.now()
    const { decision, comment: text, costume, source, reason } = await comment((config.geminiFrames === 'both' ? image?.frames?.map((frame) => frame.jpegBuffer) : null) ?? image?.jpegBuffer ?? null)
    row.gemini_ms = Date.now() - geminiStarted
    row.gemini_decision = decision
    row.costume_label = costume ?? ''
    row.comment_text = text ?? ''
    row.comment_source = source ?? ''
    if (source === 'stock') problems.push(`comment: stock line (${reason})`)
    if (decision === 'SKIP') {
      // 'fallback' says a compliment anyway, in case Gemini missed a real visitor.
      if (skipBehavior !== 'silence') {
        const clip = pickClip(skipBehavior === 'fallback' ? 'fallback' : 'skip')
        if (clip) {
          row.audio_path = clip
          await play(clip, { output, camera })
        }
      }
      status = 'skipped'
      row.success = true
      return { status, row }
    }
    const ttsStarted = Date.now()
    let wavPath
    try {
      wavPath = await speak(text)
    } catch (error) {
      problems.push(`tts: ${error.message}`)
      wavPath = pickClip('fallback') ?? pickClip('error')
      row.comment_source = 'clip'
      row.comment_text = clipText(wavPath ?? '')
      if (!wavPath) throw new Error('No voice and no clips to fall back on')
    }
    row.tts_ms = Date.now() - ttsStarted
    row.audio_path = wavPath
    const played = await play(wavPath, { output, camera })
    const coverResult = await coverPlay
    row.comment_at = iso(played.firstAudioAt)
    row.first_audio_at = iso(coverResult?.firstAudioAt ?? played.firstAudioAt)
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
    // A SKIP or failure still heard the cover clip: wait so the cooldown starts after it.
    const coverResult = await coverPlay
    if (!row.first_audio_at && coverResult?.firstAudioAt) row.first_audio_at = iso(coverResult.firstAudioAt)
    if (session) {
      row.session_open_ms = session.marks.speaker_ready ?? ''
      endActiveSession('finished')
    }
    row.error = problems.join('; ')
    gate.release()
    write()
  }
}
