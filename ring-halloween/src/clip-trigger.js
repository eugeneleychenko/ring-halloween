import path from 'node:path'
import { pickClip } from './clip-bank.js'
import { measurementPath } from './config.js'
import { appendCsvRow } from './csv.js'
import { createTriggerGate, onTrigger } from './pipeline.js'
import { stubSnapshot } from './stubs.js'

export const CLIP_LOG_COLUMNS = ['event_received_at', 'event_type', 'ding_id', 'delay_from_triggered_ms', 'first_audio_at', 'clip', 'status', 'error']

/**
 * The minimum version of the night: any Ring event plays one random Malyx clip on the
 * speaker, with no Gemini, no TTS and no doorbell audio. Through the normal onTrigger,
 * so the cooldown and runs.csv work the same as they will for the full chain.
 */
export function createClipTrigger({ camera, gate = createTriggerGate(), pick = () => pickClip('fallback'), play, log = console.log } = {}) {
  return async function clipTrigger(event) {
    let clip = null
    const result = await onTrigger(event, {
      camera,
      gate,
      output: 'bluetooth',
      openSession: () => null,
      snapshot: stubSnapshot,
      storeSnapshot: null,
      comment: async () => ({ decision: 'COMMENT', comment: '' }),
      speak: async () => {
        clip = pick()
        if (!clip) throw new Error('No clips found: run npm run build-clips')
        return clip
      },
      play,
      signOff: false,
      log,
    })
    const row = {
      event_received_at: new Date(event.receivedAt).toISOString(),
      event_type: event.type,
      ding_id: event.id,
      delay_from_triggered_ms: event.triggeredAt ? event.receivedAt - event.triggeredAt : '',
      first_audio_at: result.row?.first_audio_at ?? '',
      clip: clip ? path.basename(clip) : '',
      status: result.status,
      error: result.row?.error ?? '',
    }
    appendCsvRow(measurementPath('clip-triggers.csv'), CLIP_LOG_COLUMNS, row)
    log(`[trigger] ${row.event_type} ${row.ding_id}: ${row.status}, delay ${row.delay_from_triggered_ms} ms, first audio ${row.first_audio_at}, clip ${row.clip}${row.error ? `, ${row.error}` : ''}`)
    return { ...result, clip }
  }
}
