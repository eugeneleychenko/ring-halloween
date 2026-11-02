import fs from 'node:fs'
import path from 'node:path'
import { config, measurementPath, SNAPSHOTS_DIR } from './config.js'
import { appendCsvRow } from './csv.js'
import { getActiveSession, DoorbellSession } from './live-session.js'
import { grabKeyframe } from './keyframe.js'

const isJpeg = (buffer) => buffer?.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8

const withTimeout = (promise, ms, label) => {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms) }),
  ]).finally(() => clearTimeout(timer))
}

// camera.getSnapshot() can hand back its cached image from the last 10 s, which may
// be from before this event. These routes use getNextSnapshot(), which never does.
async function uuidRoute(event, camera, cfg) {
  const waitMs = camera.operatingOnBattery ? cfg.snapshotUuidWaitBatteryMs : cfg.snapshotUuidWaitWiredMs
  const uuid = event.snapshotUuid ?? (await event.waitForSnapshotUuid?.(waitMs))
  if (!uuid) throw new Error('No snapshot UUID on this event (needs a Ring plan and Rich Notifications)')
  const image = await withTimeout(camera.getNextSnapshot({ uuid }), cfg.snapshotRouteTimeoutMs, 'UUID snapshot')
  if (!isJpeg(image)) throw new Error('UUID snapshot was not a JPEG')
  // This image belongs to this ding but is shot as motion triggers, so it can be
  // stamped just before triggered_at. Allow a small margin; older than that is stale.
  const takenAt = image.timeMillis || null
  if (takenAt !== null && takenAt < event.eventAt - cfg.snapshotUuidToleranceMs) {
    throw new Error(`UUID snapshot is stale: taken ${event.eventAt - takenAt} ms before the event`)
  }
  return { jpegBuffer: Buffer.from(image), takenAt: takenAt ?? event.eventAt, takenAtKnown: takenAt !== null }
}

async function keyframeRoute(event, camera, cfg, signal) {
  const shared = getActiveSession()
  const session = shared ?? new DoorbellSession(camera, { cfg })
  const stopOwnCall = () => { if (!shared) session.end('keyframe_not_needed') }
  signal?.addEventListener('abort', stopOwnCall, { once: true })
  try {
    // The call is what's needed here; the speaker being ready is not.
    const call = await waitForCall(session, signal)
    const frame = await grabKeyframe(call, { ffmpegPath: cfg.ffmpegPath, timeoutMs: cfg.keyframeTimeoutMs, signal })
    if (frame.takenAt <= event.eventAt) throw new Error('Keyframe predates the event; check the Mac clock')
    return { ...frame, takenAtKnown: true }
  } finally {
    signal?.removeEventListener('abort', stopOwnCall)
    if (!shared) session.end('keyframe_done')
  }
}

async function waitForCall(session, signal) {
  let failure = null
  session.ready.catch((error) => { failure = error })
  while (!session.call) {
    if (signal?.aborted) throw new Error('Not needed: another route won')
    if (failure) throw failure
    if (session.ended) throw new Error('Live call ended before it started')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return session.call
}

async function forcedRoute(event, camera, cfg) {
  // False on battery power and on the budget wired doorbell, doorbell_graham_cracker.
  if (!camera.canTakeSnapshotWhileRecording) {
    throw new Error('Forced snapshot skipped: this camera cannot capture while recording')
  }
  const image = await withTimeout(
    camera.getNextSnapshot({ afterMs: event.eventAt, force: true }),
    cfg.snapshotRouteTimeoutMs,
    'Forced snapshot',
  )
  if (!isJpeg(image)) throw new Error('Forced snapshot was not a JPEG')
  if (!image.timeMillis || image.timeMillis <= event.eventAt) {
    throw new Error(`Forced snapshot is not newer than the event (taken ${image.timeMillis ?? 'unknown'}, event ${event.eventAt})`)
  }
  return { jpegBuffer: Buffer.from(image), takenAt: image.timeMillis, takenAtKnown: true }
}

export const SNAPSHOT_ROUTES = { uuid: uuidRoute, keyframe: keyframeRoute, forced: forcedRoute }

export class SnapshotUnavailableError extends Error {
  constructor(attempts) {
    super(`No fresh snapshot: ${attempts.map((a) => `${a.route}: ${a.error}`).join('; ')}`)
    this.attempts = attempts
  }
}

/**
 * Tries every route at once and returns the first image proven to be from this event:
 * the push UUID image, a live-stream keyframe, and a forced snapshot on wired cameras.
 * Throws SnapshotUnavailableError instead of ever returning a stale frame.
 */
export async function getFreshSnapshot(event, { camera = event.camera, cfg = config, routes = ['uuid', 'keyframe', 'forced'], now = Date.now } = {}) {
  const started = now()
  const attempts = []
  const controller = new AbortController()
  const running = routes.map(async (route) => {
    const routeStarted = now()
    try {
      const image = await SNAPSHOT_ROUTES[route](event, camera, cfg, controller.signal)
      attempts.push({ route, ms: now() - routeStarted, ok: true })
      return { ...image, source: route }
    } catch (error) {
      attempts.push({ route, ms: now() - routeStarted, ok: false, error: error.message })
      throw error
    }
  })
  try {
    const image = await Promise.any(running)
    // Routes still running get stopped. Record that, so the log shows every route's fate.
    const finished = new Set(attempts.map((attempt) => attempt.route))
    const stoppedAt = now() - started
    const all = [...attempts, ...routes.filter((route) => !finished.has(route)).map((route) => ({ route, ok: null, cancelled: true, ms: stoppedAt }))]
    return { ...image, requestedAt: started, receivedAt: now(), fetchMs: stoppedAt, attempts: all }
  } catch {
    throw new SnapshotUnavailableError(attempts)
  } finally {
    controller.abort()
  }
}

/**
 * A frame from about `delayMs` after the event, when the visitor has come closer. The
 * push image is shot as motion starts, so it tends to show someone still far away.
 * Hangs up afterwards: Ring sends no motion events while a call is open.
 */
export async function getCloserFrame(event, { camera = event.camera, cfg = config, delayMs = cfg.closerFrameDelayMs, now = Date.now } = {}) {
  const started = now()
  const shared = getActiveSession()
  const session = shared ?? new DoorbellSession(camera, { cfg, videoOnly: true })
  try {
    await session.ready
    const wait = event.receivedAt + delayMs - now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    const frame = await grabKeyframe(session.call, { ffmpegPath: cfg.ffmpegPath, timeoutMs: cfg.keyframeTimeoutMs })
    return { ...frame, takenAtKnown: true, source: 'closer', requestedAt: started, receivedAt: now(), fetchMs: now() - started, attempts: [{ route: 'closer', ms: now() - started, ok: true }] }
  } finally {
    if (!shared) session.end('closer_frame_done')
  }
}

/**
 * The push image and the later frame, for Gemini. Either alone will do. The fast image
 * proves someone was there at the event; the later one shows the costume better.
 * Waits a limited time for the later frame, so that a slow call can't hold up a comment.
 */
export async function getVisitorFrames(event, { camera = event.camera, cfg = config, fast = getFreshSnapshot, closer = getCloserFrame, closerWaitMs = cfg.closerFrameWaitMs } = {}) {
  const fastAttempt = fast(event, { camera, cfg, routes: ['uuid', 'forced'] })
  if (cfg.closerFrame === false) {
    const image = await fastAttempt
    return { ...image, frames: [image] }
  }
  const closerAttempt = closer(event, { camera, cfg })
  const timedOut = new Promise((resolve) => { setTimeout(() => resolve(null), closerWaitMs).unref?.() })
  const [fastResult, closerResult] = await Promise.all([
    fastAttempt.catch((error) => error),
    Promise.race([closerAttempt, timedOut]).catch((error) => error),
  ])
  closerAttempt.catch(() => {})
  if (closerResult instanceof Error) console.warn(`[closer] ${event.id} failed: ${closerResult.message}`)
  if (closerResult === null) console.warn(`[closer] ${event.id} too slow, gave up after ${closerWaitMs} ms`)
  const frames = [fastResult, closerResult].filter((frame) => frame && !(frame instanceof Error))
  if (!frames.length) {
    const reasons = [fastResult, closerResult].map((r) => (r instanceof Error ? r.message : 'later frame too slow')).join('; ')
    throw new SnapshotUnavailableError([{ route: 'all', ok: false, error: reasons }])
  }
  const best = frames.at(-1)
  return { ...best, source: frames.map((frame) => frame.source).join('+'), frames }
}

export function jpegSize(buffer) {
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return { width: null, height: null }
    const marker = buffer[offset + 1]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    offset += 2 + buffer.readUInt16BE(offset + 2)
  }
  return { width: null, height: null }
}

export const SNAPSHOT_COLUMNS = [
  'ding_id', 'route', 'requested_at', 'taken_at', 'received_at', 'fresh', 'width', 'height',
  'event_type', 'fetch_ms', 'taken_minus_event_ms', 'taken_at_known', 'bytes', 'file', 'attempts',
]

export function saveSnapshot(event, image) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
  const file = path.join(SNAPSHOTS_DIR, `${event.id}-${image.source}.jpg`)
  fs.writeFileSync(file, image.jpegBuffer, { mode: 0o600 })
  return file
}

export function snapshotRow(event, result, { file = null } = {}) {
  const iso = (ms) => (ms ? new Date(ms).toISOString() : '')
  const failed = result instanceof Error
  return {
    ding_id: event.id,
    route: failed ? '' : result.source,
    requested_at: failed ? '' : iso(result.requestedAt),
    taken_at: failed ? '' : iso(result.takenAt),
    received_at: failed ? '' : iso(result.receivedAt),
    fresh: !failed,
    ...(failed ? { width: '', height: '' } : jpegSize(result.jpegBuffer)),
    event_type: event.type,
    fetch_ms: failed ? '' : result.fetchMs,
    taken_minus_event_ms: failed ? '' : result.takenAt - event.eventAt,
    taken_at_known: failed ? '' : result.takenAtKnown,
    bytes: failed ? '' : result.jpegBuffer.length,
    file,
    attempts: JSON.stringify(result.attempts ?? []),
  }
}

// Saves the image if there is one and logs the outcome either way.
export function recordSnapshot(event, result) {
  const file = result instanceof Error ? null : saveSnapshot(event, result)
  appendCsvRow(measurementPath('snapshots.csv'), SNAPSHOT_COLUMNS, snapshotRow(event, result, { file }))
  return file
}
