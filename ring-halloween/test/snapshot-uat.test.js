import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ReplaySubject, Subject } from 'rxjs'
import { StreamingSession } from 'ring-client-api/streaming/streaming-session'
import { ASSETS_DIR, config } from '../src/config.js'
import { parseCsv } from '../src/csv.js'
import { createEvent, eventRow, EVENT_COLUMNS } from '../src/events.js'
import { getFreshSnapshot, getVisitorFrames, jpegSize, SnapshotUnavailableError, snapshotRow, SNAPSHOT_COLUMNS } from '../src/snapshot.js'
import { applyRating } from '../src/speaker-rating.js'
import { formatSummary, PROBE_COLUMNS, summarizeProbe } from '../src/probe-summary.js'
import { buildMeasurements } from '../src/measurements.js'
import { CHECKPOINTS, runCheckpoint, suggestResult, UAT_COLUMNS } from '../src/uat.js'

const JPEG = fs.readFileSync(path.join(ASSETS_DIR, 'stub-snapshot.jpg'))
const EVENT_AT = Date.now() - 1000
const cfg = { ...config, snapshotUuidWaitBatteryMs: 200, snapshotUuidWaitWiredMs: 50, snapshotRouteTimeoutMs: 300, keyframeTimeoutMs: 300, cameraConnectedTimeoutMs: 300, ffmpegPath: 'ffmpeg' }
const image = (timeMillis) => Object.assign(Buffer.from(JPEG), { timeMillis })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const event = (extra = {}) => ({ id: 'd1', type: 'motion', receivedAt: EVENT_AT + 500, eventAt: EVENT_AT, snapshotUuid: null, waitForSnapshotUuid: async () => null, ...extra })
const noCall = async () => { throw new Error('no call in this test') }

function camera({ wiredOk = true, next, startLiveCall = noCall } = {}) {
  return { canTakeSnapshotWhileRecording: wiredOk, operatingOnBattery: !wiredOk, getNextSnapshot: next, startLiveCall }
}

test('the first fresh route wins even if a slower one is still running', async () => {
  const next = async ({ uuid, force }) => {
    if (uuid) { await sleep(150); return image(EVENT_AT + 10) }
    if (force) return image(EVENT_AT + 50)
    throw new Error('unexpected')
  }
  const result = await getFreshSnapshot(event({ snapshotUuid: 'u1' }), { camera: camera({ next }), cfg })
  assert.equal(result.source, 'forced')
  assert.equal(result.takenAt, EVENT_AT + 50)
  const fate = Object.fromEntries(result.attempts.map((a) => [a.route, a.ok === true ? 'won' : a.cancelled ? 'cancelled' : 'failed']))
  assert.equal(fate.forced, 'won')
  assert.equal(fate.uuid, 'cancelled')
  assert.equal(Object.keys(fate).length, 3, 'every route is accounted for')
  assert.ok(result.jpegBuffer.length > 0)
})

test('a 404 on the push image falls through to the next route', async () => {
  const next = async ({ uuid }) => {
    if (uuid) throw Object.assign(new Error('Not found'), { response: { status: 404 } })
    return image(EVENT_AT + 50)
  }
  const result = await getFreshSnapshot(event({ snapshotUuid: 'u1' }), { camera: camera({ next }), cfg })
  assert.equal(result.source, 'forced')
  assert.equal(result.attempts.find((a) => a.route === 'uuid').ok, false)
})

test('a stale image is refused, and every route failing never returns a frame', async () => {
  const next = async ({ uuid }) => image(uuid ? EVENT_AT - 60000 : EVENT_AT - 5)
  await assert.rejects(
    getFreshSnapshot(event({ snapshotUuid: 'u1' }), { camera: camera({ next }), cfg }),
    (error) => error instanceof SnapshotUnavailableError && /stale/.test(error.message) && /not newer/.test(error.message),
  )
})

test('the forced route is skipped on battery and cameras that cannot capture while recording', async () => {
  let forced = 0
  const next = async ({ force }) => { if (force) forced++; return image(EVENT_AT + 1) }
  await assert.rejects(getFreshSnapshot(event(), { camera: camera({ wiredOk: false, next }), cfg, routes: ['forced'] }), /skipped/)
  assert.equal(forced, 0)
})

test('on battery the push route waits up to the limit for the second push', async () => {
  let waited = null
  const next = async () => image(EVENT_AT + 1)
  const result = await getFreshSnapshot(event({ waitForSnapshotUuid: async (ms) => { waited = ms; return 'late-uuid' } }), { camera: camera({ wiredOk: false, next }), cfg, routes: ['uuid'] })
  assert.equal(result.source, 'uuid')
  assert.equal(waited, 200)
  assert.equal(config.snapshotUuidWaitBatteryMs, 2000)
})

test('winning route stops a call opened only for a keyframe', async () => {
  const connection = {
    onAudioRtp: new Subject(), onVideoRtp: new Subject(), onCallAnswered: new ReplaySubject(1), onCallEnded: new ReplaySubject(1),
    onError: new ReplaySubject(1), onCameraConnected: new ReplaySubject(1), onMessage: new ReplaySubject(),
    stopped: 0, activateCameraSpeaker() {}, sendSessionMessage() {}, sendAudioPacket() {}, requestKeyFrame() {},
    stop() { this.stopped++; this.onCallEnded.next() },
  }
  const startLiveCall = async function () { return new StreamingSession({ name: 'door' }, connection) }
  const next = async () => image(EVENT_AT + 1)
  const result = await getFreshSnapshot(event({ snapshotUuid: 'u1' }), { camera: camera({ next, startLiveCall }), cfg, routes: ['uuid', 'keyframe'] })
  assert.equal(result.source, 'uuid')
  await sleep(100)
  assert.equal(connection.stopped, 1, 'own call must be hung up')
})

const frameFrom = (source) => ({ jpegBuffer: JPEG, source, takenAt: EVENT_AT + 1, takenAtKnown: true })
test('Gemini gets both frames when both exist, the later one counts as the snapshot', async () => {
  const result = await getVisitorFrames(event(), { camera: {}, cfg, fast: async () => frameFrom('uuid'), closer: async () => frameFrom('closer'), closerWaitMs: 100 })
  assert.equal(result.source, 'uuid+closer')
  assert.equal(result.frames.length, 2)
})

test('either frame alone is enough, a slow later frame is not waited for, and none at all is an error', async () => {
  const opts = { camera: {}, cfg, closerWaitMs: 30 }
  assert.equal((await getVisitorFrames(event(), { ...opts, fast: async () => frameFrom('uuid'), closer: async () => { throw new Error('no call') } })).source, 'uuid')
  assert.equal((await getVisitorFrames(event(), { ...opts, fast: async () => { throw new Error('404') }, closer: async () => frameFrom('closer') })).source, 'closer')
  const started = Date.now()
  const slow = await getVisitorFrames(event(), { ...opts, fast: async () => frameFrom('uuid'), closer: () => new Promise(() => {}) })
  assert.equal(slow.source, 'uuid')
  assert.ok(Date.now() - started < 300)
  await assert.rejects(getVisitorFrames(event(), { ...opts, fast: async () => { throw new Error('404') }, closer: async () => { throw new Error('no call') } }), /404.*no call/)
})

test('jpegSize reads real dimensions, and the snapshot row has the agreed columns', () => {
  assert.deepEqual(jpegSize(JPEG), { width: 640, height: 360 })
  assert.deepEqual(SNAPSHOT_COLUMNS.slice(0, 8), ['ding_id', 'route', 'requested_at', 'taken_at', 'received_at', 'fresh', 'width', 'height'])
  const row = snapshotRow(event(), { jpegBuffer: JPEG, source: 'uuid', takenAt: EVENT_AT + 5, requestedAt: EVENT_AT, receivedAt: EVENT_AT + 9, fetchMs: 9, takenAtKnown: true })
  assert.equal(row.fresh, true)
  assert.equal(row.width, 640)
  assert.equal(snapshotRow(event(), new Error('x')).fresh, false)
})

test('the events row has the agreed columns and delay', () => {
  assert.deepEqual(EVENT_COLUMNS.slice(0, 6), ['received_at', 'triggered_at', 'delay_ms', 'category', 'ding_id', 'has_snapshot_uuid'])
  const e = createEvent({
    android_config: { category: 'com.ring.pn.live-event.ding' },
    analytics: { triggered_at: 1793000000000, sent_at: 1793000000084 },
    data: { event: { ding: { id: '7' }, eventito: { timestamp: 1793000000010 } } },
    img: { snapshot_uuid: 'abc' },
  }, 1793000001000, {})
  const row = eventRow(e)
  assert.equal(row.delay_ms, 1000)
  assert.equal(row.category, 'ding')
  assert.equal(row.has_snapshot_uuid, true)
  assert.equal(row.triggered_at, new Date(1793000000000).toISOString())
})

test('the speaker columns, summary and report line up', () => {
  assert.deepEqual(PROBE_COLUMNS.slice(0, 7), ['try', 'started_at', 'codec', 'session_open_ms', 'first_rtp_ms', 'success', 'error'])
  const rows = Array.from({ length: 5 }, (_, i) => ({ success: 'true', session_open_ms: String(2000 + i * 100), first_rtp_ms: '900', audible_2m: 'y', clipped_start: i === 0 ? 'y' : 'n', clipped_end: 'n', codec: 'opus/48000/2' }))
  const s = summarizeProbe(rows)
  assert.equal(s.verdict, 'GO')
  assert.equal(s.speakerReadyP95Ms, 2380)
  assert.equal(s.clippedStart, 1)
  assert.match(formatSummary(s), /p95 2380 ms.*First RTP: median 900 ms/)
  const table = buildMeasurements({
    probes: rows,
    events: [{ category: 'motion', delay_ms: '1200', is_duplicate: 'false' }, { category: 'ding', delay_ms: '800', is_duplicate: 'false' }, { category: 'motion', delay_ms: '9999', is_duplicate: 'true' }],
    snapshots: [{ fresh: 'true', fetch_ms: '1500', route: 'uuid' }, { fresh: 'false', fetch_ms: '' }],
    trials: [{ result: 'hit' }, { result: 'miss' }],
  })
  const byName = Object.fromEntries(table.map((r) => [r.Metric, r]))
  assert.match(byName['Motion event delay (motion to event received)'].Measured, /median 1\.20 s/)
  assert.match(byName['Event miss rate (staged trials)'].Measured, /1\/2/)
  assert.match(byName['Snapshot time and freshness'].Measured, /1\/2 fresh images \(uuid 1\)/)
  assert.match(byName['Doorbell audio success rate (20 tries)'].Measured, /5\/5/)
})

test('relayed ratings land on the right try of the right run, and bad values are refused', () => {
  const rows = [{ run_id: 'old', try: '1' }, { run_id: 'new', try: '1' }, { run_id: 'new', try: '2' }]
  applyRating(rows, { tryNumber: 2, audible: 'y', clippedStart: 'n', clippedEnd: 'y', note: 'quiet' })
  assert.deepEqual(rows[2], { run_id: 'new', try: '2', audible_2m: 'y', clipped_start: 'n', clipped_end: 'y', note: 'quiet' })
  assert.equal(rows[0].audible_2m, undefined)
  assert.throws(() => applyRating(rows, { tryNumber: 1, audible: 'maybe' }), /must be y or n/)
  assert.throws(() => applyRating(rows, { tryNumber: 9, audible: 'y' }), /No row/)
})

test('probe flags: the real probe script rejects a short gap before touching Ring', () => {
  const result = spawnSync('bin/node24', ['src/cli/probe.js', '--tries', '1', '--gap', '5'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /at least 30 seconds/)
})

test('suggestions: suppressed, one comment only, no comment', () => {
  const played = { status: 'played' }
  const suppressed = { status: 'suppressed' }
  assert.equal(suggestResult({ expect: 'suppressed' }, [suppressed]), true)
  assert.equal(suggestResult({ expect: 'suppressed' }, [played]), false)
  assert.equal(suggestResult({ expect: 'suppressed' }, []), false)
  assert.equal(suggestResult({ expect: 'one_comment' }, [played, played]), false)
  assert.equal(suggestResult({ expect: 'no_comment' }, [{ status: 'skipped' }]), true)
  assert.equal(suggestResult({ expect: 'any' }, []), null)
})

test('a checkpoint writes the agreed CSV and a scorecard, including a scenario with no trigger', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uat-'))
  const file = path.join(dir, 'uat-1.csv')
  const answers = () => 'y'
  const row = { trigger_id: 't1', event_received_at: '2026-10-31T20:00:00.000Z', first_audio_at: '2026-10-31T20:00:02.500Z', gemini_decision: 'COMMENT' }
  const logged = []
  const { scorecard } = await runCheckpoint(1, {
    ask: async () => answers(),
    file,
    log: (m) => logged.push(m),
    collectTriggers: async (scenario) => (scenario.id === 5 ? [] : [{ status: scenario.expect === 'suppressed' ? 'suppressed' : 'played', row, comment: 'hello' }]),
  })
  const text = fs.readFileSync(file, 'utf8')
  assert.equal(text.split('\n')[0], UAT_COLUMNS.join(','))
  assert.deepEqual(UAT_COLUMNS, ['checkpoint', 'scenario', 'trigger_id', 'event_received_at', 'first_audio_at', 'comment_at', 'output', 'gemini_decision', 'comment_text', 'pass', 'eugene_note'])
  const rows = parseCsv(text)
  assert.equal(rows.length, 5)
  assert.equal(rows[0].comment_text, 'hello')
  assert.equal(rows[4].trigger_id, '')
  assert.match(scorecard, /3\/3 graded scenarios passed/)
  assert.match(scorecard, /median 2500 ms/)
  assert.deepEqual(CHECKPOINTS[3].scenarios.map((s) => s.id), [1, 3, 4, 5, 9, 10, 11])
  await assert.rejects(runCheckpoint(9, { ask: async () => '', collectTriggers: async () => [] }), /must be 1, 2 or 3/)
})
