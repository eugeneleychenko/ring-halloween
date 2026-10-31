// Motion and doorbell-press events from camera.onNewNotification, not
// onMotionStarted: that one only fires on a none-to-active change and a ding stays
// active for 65 s, so a second group inside that window would be lost.
const CATEGORY_TO_TYPE = {
  'com.ring.pn.live-event.ding': 'ding',
  'com.ring.pn.live-event.motion': 'motion',
}
const DEDUPE_TTL_MS = 5 * 60 * 1000

export function toMs(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (Number.isFinite(number)) return number < 1e11 ? number * 1000 : number
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function createEvent(notification, receivedAt, camera) {
  const ding = notification.data.event.ding
  const eventito = notification.data.event.eventito
  const triggeredAt = toMs(notification.analytics?.triggered_at)
  const eventitoAt = toMs(eventito?.timestamp)
  const createdAt = toMs(ding.created_at)
  const waiters = new Set()
  const event = {
    id: String(ding.id),
    type: CATEGORY_TO_TYPE[notification.android_config.category],
    subtype: ding.subtype ?? null,
    detectionType: ding.detection_type ?? eventito?.type ?? null,
    receivedAt,
    triggeredAt,
    sentAt: toMs(notification.analytics?.sent_at),
    eventitoAt,
    createdAt,
    // Best available time of the event itself, on Ring's clock.
    eventAt: triggeredAt ?? eventitoAt ?? createdAt ?? receivedAt,
    e2eeEnabled: notification.data.device?.e2ee_enabled ?? null,
    snapshotUuid: notification.img?.snapshot_uuid ?? null,
    camera,
    // Battery cameras can send the snapshot UUID in a second push for the same ding.
    waitForSnapshotUuid(timeoutMs) {
      if (event.snapshotUuid) return Promise.resolve(event.snapshotUuid)
      return new Promise((resolve) => {
        const waiter = (uuid) => {
          clearTimeout(timer)
          waiters.delete(waiter)
          resolve(uuid)
        }
        const timer = setTimeout(() => waiter(null), timeoutMs)
        waiters.add(waiter)
      })
    },
    _setSnapshotUuid(uuid) {
      if (!uuid || event.snapshotUuid) return
      event.snapshotUuid = uuid
      for (const waiter of [...waiters]) waiter(uuid)
    },
  }
  return event
}

export function createEventRouter(camera, { onEvent, onDuplicate = () => {}, now = Date.now } = {}) {
  const seen = new Map()
  return function handleNotification(notification) {
    const receivedAt = now()
    const type = CATEGORY_TO_TYPE[notification?.android_config?.category]
    const id = notification?.data?.event?.ding?.id
    if (!type || id === undefined) return
    for (const [key, entry] of seen) {
      if (receivedAt - entry.receivedAt > DEDUPE_TTL_MS) seen.delete(key)
    }
    const existing = seen.get(String(id))
    if (existing) {
      existing._setSnapshotUuid(notification.img?.snapshot_uuid)
      onDuplicate(existing, { receivedAt, snapshotUuid: notification.img?.snapshot_uuid ?? null })
      return
    }
    const event = createEvent(notification, receivedAt, camera)
    seen.set(event.id, event)
    onEvent(event)
  }
}

export function watchEvents(camera, handlers) {
  const route = createEventRouter(camera, handlers)
  const subscription = camera.onNewNotification.subscribe(route)
  return () => subscription.unsubscribe()
}

export const EVENT_COLUMNS = [
  'received_at', 'triggered_at', 'delay_ms', 'category', 'ding_id', 'has_snapshot_uuid',
  'is_duplicate', 'eventito_at', 'sent_at', 'sent_minus_triggered_ms', 'received_minus_sent_ms',
  'subtype', 'detection_type', 'e2ee_enabled',
]

export function eventRow(event, { isDuplicate = false, receivedAt = event.receivedAt, snapshotUuid = event.snapshotUuid } = {}) {
  const delta = (a, b) => (a !== null && b !== null ? a - b : '')
  const iso = (ms) => (ms === null ? '' : new Date(ms).toISOString())
  return {
    received_at: iso(receivedAt),
    triggered_at: iso(event.triggeredAt),
    delay_ms: delta(receivedAt, event.triggeredAt),
    category: event.type,
    ding_id: event.id,
    has_snapshot_uuid: Boolean(snapshotUuid),
    is_duplicate: isDuplicate,
    eventito_at: iso(event.eventitoAt),
    sent_at: iso(event.sentAt),
    sent_minus_triggered_ms: delta(event.sentAt, event.triggeredAt),
    received_minus_sent_ms: delta(receivedAt, event.sentAt),
    subtype: event.subtype,
    detection_type: event.detectionType,
    e2ee_enabled: event.e2eeEnabled,
  }
}
