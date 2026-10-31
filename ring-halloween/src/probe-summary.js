export const PROBE_COLUMNS = [
  'run_id', 'try', 'started_at', 'mode', 'model', 'kind', 'power', 'codec', 'video_codec',
  'event_type', 'received_minus_triggered_ms', 'call_created_ms', 'answered_ms', 'camera_connected_ms',
  'speaker_ready_ms', 'first_audio_ms', 'rtp_packets', 'rtp_expected', 'clip_ms',
  'technical_ok', 'heard', 'note', 'ended_early', 'error',
]
const OPEN_TARGET_MS = 5000

export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const position = (sorted.length - 1) * p
  const low = Math.floor(position)
  const high = Math.ceil(position)
  return Math.round(sorted[low] + (sorted[high] - sorted[low]) * (position - low))
}

const truthy = (value) => value === true || value === 'true'
const num = (value) => (value === '' || value === null || value === undefined ? NaN : Number(value))

/**
 * RTP going out proves nothing about the sound at the door, so a verdict of GO needs
 * a person to have heard it. A try only counts as a success when both agree.
 */
export function summarizeProbe(rows) {
  const tries = rows.length
  const technicalOk = rows.filter((r) => truthy(r.technical_ok)).length
  const asked = rows.filter((r) => r.heard === 'y' || r.heard === 'n').length
  const heard = rows.filter((r) => r.heard === 'y').length
  const successes = rows.filter((r) => truthy(r.technical_ok) && r.heard === 'y').length
  const ready = rows.map((r) => num(r.speaker_ready_ms))
  const summary = {
    tries,
    technicalOk,
    technicalRate: tries ? technicalOk / tries : 0,
    asked,
    heard,
    successes,
    successRate: asked ? successes / asked : null,
    speakerReadyMedianMs: percentile(ready, 0.5),
    speakerReadyP90Ms: percentile(ready, 0.9),
    speakerReadyMaxMs: percentile(ready, 1),
    firstAudioMedianMs: percentile(rows.map((r) => num(r.first_audio_ms)), 0.5),
    codecs: [...new Set(rows.map((r) => r.codec).filter(Boolean))],
    videoCodecs: [...new Set(rows.map((r) => r.video_codec).filter(Boolean))],
    errors: rows.map((r) => r.error).filter(Boolean),
  }
  return { ...summary, ...verdict(summary) }
}

function verdict(s) {
  if (s.tries < 5) return { verdict: 'INSUFFICIENT', reason: `${s.tries} tries; 5 are needed for a call` }
  if (s.technicalOk === 0) return { verdict: 'NO-GO', reason: 'No try got as far as sending the whole clip' }
  if (s.asked === 0) {
    return { verdict: 'UNCONFIRMED', reason: `${s.technicalOk}/${s.tries} sent the clip, but nobody confirmed hearing it. Re-run with --ask.` }
  }
  if (s.heard === 0) return { verdict: 'NO-GO', reason: `Clip was sent ${s.technicalOk} times, heard 0 of ${s.asked}` }
  const bar = s.tries >= 20 ? 0.9 : 0.8
  if (s.successRate < bar) {
    return { verdict: 'CONDITIONAL', reason: `Audio works but only ${s.successes}/${s.asked} succeeded (bar ${bar * 100}%)` }
  }
  if (s.speakerReadyMedianMs > OPEN_TARGET_MS) {
    return { verdict: 'CONDITIONAL', reason: `Audio works but median speaker-ready ${s.speakerReadyMedianMs} ms misses the 5 s target` }
  }
  return { verdict: 'GO', reason: `${s.successes}/${s.asked} heard, median speaker-ready ${s.speakerReadyMedianMs} ms` }
}

export function formatSummary(s) {
  return [
    `Verdict: ${s.verdict} (${s.reason})`,
    `  Tries: ${s.tries}. Clip fully sent: ${s.technicalOk}. Heard: ${s.asked ? `${s.heard}/${s.asked}` : 'not asked'}`,
    `  Speaker ready: median ${s.speakerReadyMedianMs ?? 'n/a'} ms, p90 ${s.speakerReadyP90Ms ?? 'n/a'} ms, max ${s.speakerReadyMaxMs ?? 'n/a'} ms`,
    `  Audio codec: ${s.codecs.join(', ') || 'n/a'}. Video codec: ${s.videoCodecs.join(', ') || 'n/a'}`,
    ...(s.errors.length ? [`  Errors: ${[...new Set(s.errors)].join(' | ')}`] : []),
  ].join('\n')
}
