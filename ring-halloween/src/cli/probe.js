import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { firstValueFrom, Subject } from 'rxjs'
import { ASSETS_DIR, measurementPath } from '../config.js'
import { appendCsvRow, readCsv } from '../csv.js'
import { watchEvents } from '../events.js'
import { DoorbellSession } from '../live-session.js'
import { ask } from '../prompt.js'
import { formatSummary, PROBE_COLUMNS, summarizeProbe } from '../probe-summary.js'
import { connectRing, describeCamera, pickDoorbell, printCamera } from '../ring.js'

const MIN_GAP_SECONDS = 30
const MIN_RTP_RATIO = 0.8
const CHECKPOINT_TRIES = 5

const { values: args } = parseArgs({
  options: {
    tries: { type: 'string', default: '20' },
    gap: { type: 'string', default: String(MIN_GAP_SECONDS) },
    ask: { type: 'boolean', default: false },
    'on-event': { type: 'boolean', default: false },
    clip: { type: 'string', default: path.join(ASSETS_DIR, 'test-clip.wav') },
  },
})
const tries = Number(args.tries)
const gapMs = Number(args.gap) * 1000
if (!(tries > 0)) throw new Error('--tries must be a positive number')
if (!(gapMs >= MIN_GAP_SECONDS * 1000)) throw new Error(`--gap must be at least ${MIN_GAP_SECONDS} seconds`)
if (!fs.existsSync(args.clip)) throw new Error(`Clip not found: ${args.clip}`)
if (args.ask && !process.stdin.isTTY) throw new Error('--ask needs a real terminal')

const ring = await connectRing()
const camera = pickDoorbell(ring.cameras)
const info = describeCamera(camera)
printCamera(info)
if (info.liveViewDisabled) {
  ring.close()
  throw new Error('Live view is disabled by a Ring Mode. Change that in the Ring app, then run this again.')
}

const runId = new Date().toISOString().replaceAll(':', '-').slice(0, 19)
const csvFile = measurementPath('speaker.csv')
const events = new Subject()
const stopEvents = watchEvents(camera, { onEvent: (event) => events.next(event) })
const rows = []
let current = null
process.on('SIGINT', () => {
  current?.end('interrupted')
  stopEvents()
  console.log(`\n${formatSummary(summarizeProbe(rows))}`)
  ring.close()
  process.exit(130)
})

async function runTry(n) {
  let event = null
  if (args['on-event']) {
    console.log(`\nTry ${n}/${tries}: waiting for motion or a doorbell press...`)
    event = await firstValueFrom(events)
  } else {
    console.log(`\nTry ${n}/${tries}: opening call...`)
  }
  const session = new DoorbellSession(camera, { t0: event?.receivedAt ?? Date.now() })
  current = session
  const row = {
    run_id: runId, try: n, started_at: new Date(session.t0).toISOString(),
    mode: event ? 'on-event' : 'timer', model: info.model, kind: info.kind,
    power: info.operatingOnBattery ? 'battery' : 'wired', event_type: event?.type ?? '',
    received_minus_triggered_ms: event?.triggeredAt ? event.receivedAt - event.triggeredAt : '',
    technical_ok: false, heard: '', note: '', ended_early: false, error: '',
  }
  try {
    await session.whenReady()
    const played = await session.play(args.clip)
    row.first_audio_ms = played.firstAudioAt ? played.firstAudioAt - session.t0 : ''
    row.rtp_packets = played.rtpPackets
    row.rtp_expected = played.rtpExpected
    row.clip_ms = played.audioMs
    row.technical_ok = played.rtpExpected > 0 && played.rtpPackets / played.rtpExpected >= MIN_RTP_RATIO
    if (!row.technical_ok) row.error = `Only ${played.rtpPackets}/${played.rtpExpected} RTP packets were sent`
  } catch (error) {
    row.error = error.message
  }
  row.ended_early = session.endedEarly
  session.end('finished')
  await session.endedPromise
  row.codec = session.codec ?? ''
  row.video_codec = session.videoCodec ?? ''
  row.call_created_ms = session.marks.call_created ?? ''
  row.answered_ms = session.marks.answered ?? ''
  row.camera_connected_ms = session.marks.camera_connected ?? ''
  row.speaker_ready_ms = session.marks.speaker_ready ?? ''
  current = null
  console.log(`  ${row.technical_ok ? 'sent OK' : 'FAILED'}: speaker ready ${row.speaker_ready_ms || 'n/a'} ms, codec ${row.codec || 'n/a'}${row.error ? `, ${row.error}` : ''}`)

  if (args.ask) {
    const answer = (await ask('  Did you hear the whole clip at the door? (y/n, or type a note after it, e.g. "y quiet") ')).trim()
    row.heard = answer[0]?.toLowerCase() === 'y' ? 'y' : answer[0]?.toLowerCase() === 'n' ? 'n' : ''
    row.note = answer.slice(1).trim()
  }
  fs.writeFileSync(
    measurementPath('probe-logs', `${runId}-try-${String(n).padStart(2, '0')}.json`),
    JSON.stringify({ row, marks: session.marks, timeline: session.timeline, endReason: session.endReason, sdp: session.sdp, player: session.player?.stats }, null, 2),
  )
  appendCsvRow(csvFile, PROBE_COLUMNS, row)
  rows.push(row)
}

for (let n = 1; n <= tries; n++) {
  await runTry(n)
  if (n === CHECKPOINT_TRIES && tries > CHECKPOINT_TRIES) {
    console.log(`\n=== Checkpoint after ${CHECKPOINT_TRIES} tries ===\n${formatSummary(summarizeProbe(rows))}\n`)
  }
  if (n < tries && !args['on-event']) {
    console.log(`  Waiting ${gapMs / 1000} s...`)
    await new Promise((resolve) => setTimeout(resolve, gapMs))
  }
}

stopEvents()
console.log(`\n=== Finished ===\n${formatSummary(summarizeProbe(rows))}`)
console.log(`Results: ${csvFile} (${readCsv(csvFile).length} rows in total). Run \`npm run report\` for the RFP table.`)
ring.close()
process.exit(0)
