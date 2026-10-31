import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { firstValueFrom, Subject } from 'rxjs'
import { ASSETS_DIR, config, measurementPath } from '../config.js'
import { appendCsvRow, readCsv } from '../csv.js'
import { watchEvents } from '../events.js'
import { DoorbellSession } from '../live-session.js'
import { ask } from '../prompt.js'
import { formatSummary, PROBE_COLUMNS, summarizeProbe } from '../probe-summary.js'
import { masterForDoorbell } from '../tts.js'
import { connectRing, describeCamera, pickDoorbell, printCamera } from '../ring.js'

const MIN_GAP_SECONDS = 30
const MIN_RTP_RATIO = 0.8
const CHECKPOINT_TRIES = 5

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    tries: { type: 'string' },
    gap: { type: 'string', default: String(MIN_GAP_SECONDS) },
    ask: { type: 'boolean', default: false },
    'on-event': { type: 'boolean', default: false },
    // Keeps each call open this long after the clip, to prove it survives past 30 s.
    'hold-seconds': { type: 'string', default: '0' },
    // Variants for comparing audio quality on one try each.
    master: { type: 'boolean', default: false },
    'no-video': { type: 'boolean', default: false },
    'no-pace': { type: 'boolean', default: false },
    'opus-bitrate': { type: 'string' },
    clip: { type: 'string', default: path.join(ASSETS_DIR, 'test-clip.wav') },
  },
})
// Without "--", npm swallows the flag: `npm run probe-speaker --tries 20` arrives as "20".
const tries = Number(args.tries ?? positionals[0] ?? process.env.npm_config_tries ?? 20)
const gapMs = Number(args.gap) * 1000
const holdMs = Number(args['hold-seconds']) * 1000
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
const cfg = {
  ...config,
  maxSessionMs: config.maxSessionMs + holdMs,
  doorbellVideoOff: args['no-video'] || config.doorbellVideoOff,
  pacedSend: !args['no-pace'] && config.pacedSend,
  opusBitrate: args['opus-bitrate'] ?? config.opusBitrate,
}
const clipPath = args.master ? await masterForDoorbell(args.clip) : args.clip
let current = null
process.on('SIGINT', () => {
  current?.end('interrupted')
  stopEvents()
  console.log(`\n${formatSummary(summarizeProbe(rows))}`)
  ring.close()
  process.exit(130)
})

const yesNo = (answer) => {
  const first = answer.trim()[0]?.toLowerCase()
  return first === 'y' || first === 'n' ? first : ''
}

async function runTry(n) {
  let event = null
  if (args['on-event']) {
    console.log(`\nTry ${n}/${tries}: waiting for motion or a doorbell press...`)
    event = await firstValueFrom(events)
  } else {
    console.log(`\nTry ${n}/${tries}: opening call...`)
  }
  const session = new DoorbellSession(camera, { t0: event?.receivedAt ?? Date.now(), cfg })
  current = session
  const row = {
    run_id: runId, try: n, started_at: new Date(session.t0).toISOString(),
    mode: event ? 'on-event' : 'timer', model: info.model, kind: info.kind,
    power: info.operatingOnBattery ? 'battery' : 'wired', event_type: event?.type ?? '',
    delay_ms: event?.triggeredAt ? event.receivedAt - event.triggeredAt : '',
    success: false, error: '', ended_early: false,
  }
  try {
    await session.whenReady()
    const played = await session.play(clipPath)
    row.first_audio_ms = played.firstAudioAt ? played.firstAudioAt - session.t0 : ''
    row.rtp_packets = played.rtpPackets
    row.rtp_expected = played.rtpExpected
    row.clip_ms = played.audioMs
    row.success = played.rtpExpected > 0 && played.rtpPackets / played.rtpExpected >= MIN_RTP_RATIO
    if (!row.success) row.error = `Only ${played.rtpPackets}/${played.rtpExpected} RTP packets were sent`
    if (holdMs) {
      const heldFrom = Date.now()
      console.log(`  Holding the call for ${holdMs / 1000} s...`)
      await Promise.race([session.endedPromise, new Promise((resolve) => setTimeout(resolve, holdMs))])
      row.held_ms = Date.now() - heldFrom
      if (session.ended) {
        row.success = false
        row.error = `Call dropped ${row.held_ms} ms into the hold, ${Date.now() - session.t0} ms after opening`
      }
    }
  } catch (error) {
    row.error = error.message
  }
  const diagnostics = session.diagnostics()
  row.ended_early = session.endedEarly
  session.end('finished')
  await session.endedPromise
  row.codec = session.codec ?? ''
  row.video_codec = session.videoCodec ?? ''
  row.call_created_ms = session.marks.call_created ?? ''
  row.answered_ms = session.marks.answered ?? ''
  row.camera_connected_ms = session.marks.camera_connected ?? ''
  row.session_open_ms = session.marks.speaker_ready ?? ''
  row.first_rtp_ms = session.player?.stats.firstRtpAt ? session.player.stats.firstRtpAt - session.t0 : ''
  current = null
  console.log(`  send gaps ms: p50 ${diagnostics.send?.gapP50} p99 ${diagnostics.send?.gapP99} max ${diagnostics.send?.gapMax}, over 40 ms: ${diagnostics.send?.gapsOver40}, under 5 ms: ${diagnostics.send?.under5}; event loop p99 ${diagnostics.loopDelayP99Ms} ms max ${diagnostics.loopDelayMaxMs} ms; Ring reports ${diagnostics.reports}, max lost ${diagnostics.maxFractionLost}/256, max jitter ${diagnostics.maxJitter}, last ${JSON.stringify(diagnostics.lastReport)}`)
  console.log(`  ${row.success ? 'sent OK' : 'FAILED'}: session open ${row.session_open_ms || 'n/a'} ms, first RTP ${row.first_rtp_ms || 'n/a'} ms, codec ${row.codec || 'n/a'}${row.error ? `, ${row.error}` : ''}`)

  if (args.ask) {
    row.audible_2m = yesNo(await ask('  Standing 2 m away, could you hear it clearly? (y/n) '))
    row.clipped_start = yesNo(await ask('  Was the start cut off? (y/n) '))
    row.clipped_end = yesNo(await ask('  Was the end cut off? (y/n) '))
    row.note = await ask('  Any note, such as how loud it was? (Return to skip) ')
  }
  fs.writeFileSync(
    measurementPath('probe-logs', `${runId}-try-${String(n).padStart(2, '0')}.json`),
    JSON.stringify({ row, diagnostics, variant: { master: args.master, noVideo: args['no-video'], noPace: args['no-pace'], opusBitrate: cfg.opusBitrate }, marks: session.marks, timeline: session.timeline, endReason: session.endReason, sdp: session.sdp, player: session.player?.stats }, null, 2),
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
