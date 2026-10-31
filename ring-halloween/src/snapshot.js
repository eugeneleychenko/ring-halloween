import fs from 'node:fs'
import path from 'node:path'
import { config, SNAPSHOTS_DIR } from './config.js'
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

async function keyframeRoute(event, camera, cfg) {
  const shared = getActiveSession()
  const session = shared ?? new DoorbellSession(camera, { cfg })
  try {
    // The call is what's needed here; the speaker being ready is not.
    const call = session.call ?? (await waitForCall(session))
    const frame = await grabKeyframe(call, { ffmpegPath: cfg.ffmpegPath, timeoutMs: cfg.keyframeTimeoutMs })
    if (frame.takenAt <= event.eventAt) throw new Error('Keyframe predates the event; check the Mac clock')
    return { ...frame, takenAtKnown: true }
  } finally {
    if (!shared) session.end('keyframe_done')
  }
}

async function waitForCall(session) {
  while (!session.call) {
    if (session.ended) throw new Error('Live call failed to start')
    await Promise.race([session.ready.catch(() => {}), new Promise((r) => setTimeout(r, 25))])
    if (!session.call && session.marks.open_failed !== undefined) await session.ready
  }
  return session.call
}

async function forcedRoute(event, camera, cfg) {
  if (!camera.canTakeSnapshotWhileRecording) {
    throw new Error('Forced snapshot is wired-only: this camera cannot capture while recording')
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
 * Returns the first image proven to be from this event:
 * push UUID image, then a live-stream keyframe, then forced getSnapshot (wired only).
 * Throws SnapshotUnavailableError instead of ever returning a stale frame.
 */
export async function getFreshSnapshot(event, { camera = event.camera, cfg = config, routes = ['uuid', 'keyframe', 'forced'], now = Date.now } = {}) {
  const started = now()
  const attempts = []
  for (const route of routes) {
    const routeStarted = now()
    try {
      const image = await SNAPSHOT_ROUTES[route](event, camera, cfg)
      attempts.push({ route, ms: now() - routeStarted, ok: true })
      return { ...image, source: route, fetchMs: now() - started, attempts }
    } catch (error) {
      attempts.push({ route, ms: now() - routeStarted, ok: false, error: error.message })
    }
  }
  throw new SnapshotUnavailableError(attempts)
}

export const SNAPSHOT_COLUMNS = [
  'logged_at', 'ding_id', 'event_type', 'ok', 'source', 'fetch_ms', 'received_to_image_ms',
  'taken_minus_event_ms', 'taken_at_known', 'bytes', 'file', 'attempts',
]

export function saveSnapshot(event, image) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
  const file = path.join(SNAPSHOTS_DIR, `${event.id}-${image.source}.jpg`)
  fs.writeFileSync(file, image.jpegBuffer, { mode: 0o600 })
  return file
}

export function snapshotRow(event, result, { file = null, now = Date.now } = {}) {
  const ok = !(result instanceof Error)
  return {
    logged_at: new Date(now()).toISOString(),
    ding_id: event.id,
    event_type: event.type,
    ok,
    source: ok ? result.source : '',
    fetch_ms: ok ? result.fetchMs : '',
    received_to_image_ms: now() - event.receivedAt,
    taken_minus_event_ms: ok ? result.takenAt - event.eventAt : '',
    taken_at_known: ok ? result.takenAtKnown : '',
    bytes: ok ? result.jpegBuffer.length : '',
    file,
    attempts: JSON.stringify(result.attempts ?? []),
  }
}
