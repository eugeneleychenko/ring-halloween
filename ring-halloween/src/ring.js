import { RingApi } from 'ring-client-api'
import { config } from './config.js'
import { acquireLock, loadToken, saveToken } from './token-store.js'

export async function connectRing() {
  const refreshToken = loadToken()
  if (!refreshToken) {
    throw new Error('No Ring token found. Run `npm run auth` first.')
  }
  const releaseLock = acquireLock()
  const api = new RingApi({
    refreshToken,
    controlCenterDisplayName: config.controlCenterDisplayName,
    ffmpegPath: config.ffmpegPath,
  })
  // Subscribe before the first request so that no rotation can be missed.
  const tokenSubscription = api.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
    saveToken(newRefreshToken)
  })
  const cameras = await api.getCameras()
  return {
    api,
    cameras,
    close() {
      tokenSubscription.unsubscribe()
      api.disconnect()
      releaseLock()
    },
  }
}

export function pickDoorbell(cameras, { deviceId = config.deviceId, deviceName = config.deviceName } = {}) {
  const list = () => cameras.map((c) => `"${c.name}" (id ${c.id}, ${c.data.kind})`).join(', ') || 'none'
  if (deviceId || deviceName) {
    const match = cameras.find((c) => String(c.id) === String(deviceId) || c.name === deviceName)
    if (!match) throw new Error(`RING_DEVICE_ID/RING_DEVICE_NAME matched nothing. Devices: ${list()}`)
    return match
  }
  const doorbells = cameras.filter((c) => c.isDoorbot)
  if (doorbells.length === 1) return doorbells[0]
  if (doorbells.length === 0) throw new Error(`No doorbell on this account. Devices: ${list()}`)
  throw new Error(`More than one doorbell. Set RING_DEVICE_NAME in .env. Devices: ${list()}`)
}

// Facts the go/no-go depends on. Contains no account or credential data.
export function describeCamera(camera) {
  const data = camera.data
  const settings = data.settings || {}
  const kind = data.kind
  const encryptionFields = Object.fromEntries(
    [...Object.entries(data), ...Object.entries(settings)].filter(([k]) => /e2ee|encrypt/i.test(k)),
  )
  return {
    name: camera.name,
    id: camera.id,
    kind,
    model: camera.model,
    isDoorbell: camera.isDoorbot,
    powerMode: settings.power_mode ?? null,
    hasBattery: camera.hasBattery,
    batteryLevel: camera.batteryLevel,
    operatingOnBattery: camera.operatingOnBattery,
    canTakeSnapshotWhileRecording: camera.canTakeSnapshotWhileRecording,
    liveViewDisabled: settings.live_view_disabled === true,
    motionDetectionEnabled: settings.motion_detection_enabled ?? null,
    isOffline: camera.isOffline,
    firmware: data.firmware_version ?? null,
    encryptionFields,
    knownRisks: knownRisks(kind, settings),
  }
}

export function knownRisks(kind, settings = {}) {
  const risks = []
  if (String(kind).startsWith('cocoa_')) {
    risks.push(
      `"${kind}" is a newer 4K model: reports of missing motion events (#1866) and HEVC-only video (Scrypted #2045).`,
    )
  }
  if (settings.live_view_disabled === true) {
    risks.push('Live view is disabled by a Ring Mode: startLiveCall() will throw until that is changed in the app.')
  }
  if (settings.motion_detection_enabled === false) {
    risks.push('Motion detection is off: no motion events and no snapshots until it is turned on.')
  }
  return risks
}

export function printCamera(info, log = console.log) {
  log(`  ${info.name}  (id ${info.id})`)
  log(`    model:        ${info.model}`)
  log(`    kind:         ${info.kind}`)
  log(`    power:        ${info.operatingOnBattery ? 'battery' : 'wired'} (power_mode=${info.powerMode ?? 'n/a'}, battery=${info.batteryLevel ?? 'n/a'})`)
  log(`    live view:    ${info.liveViewDisabled ? 'DISABLED by a Ring Mode' : 'allowed'}`)
  log(`    motion on:    ${info.motionDetectionEnabled ?? 'unknown'}`)
  log(`    offline:      ${info.isOffline}`)
  if (Object.keys(info.encryptionFields).length) log(`    encryption:   ${JSON.stringify(info.encryptionFields)}`)
  for (const risk of info.knownRisks) log(`    WARNING:      ${risk}`)
}
