import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ASSETS_DIR = path.join(ROOT, 'assets')

// A setting in ring-halloween/.env wins over the same one in the folder above it.
for (const envFile of [path.join(ROOT, '.env'), path.join(ROOT, '..', '.env')]) {
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
}

export const TOKEN_DIR = process.env.RING_TOKEN_DIR || ROOT
export const MEASUREMENTS_DIR = process.env.MEASUREMENTS_DIR || path.join(ROOT, 'measurements')
export const SNAPSHOTS_DIR = process.env.SNAPSHOTS_DIR || path.join(ROOT, 'snapshots')

const num = (name, fallback) => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`)
  return value
}

export const config = {
  controlCenterDisplayName: 'ring-halloween-mac',
  output: process.env.OUTPUT || 'bluetooth',
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || null,
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || null,
  deviceName: process.env.RING_DEVICE_NAME || null,
  deviceId: process.env.RING_DEVICE_ID || null,
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  cooldownMs: num('COOLDOWN_MS', 15000),
  cameraConnectedTimeoutMs: num('CAMERA_CONNECTED_TIMEOUT_MS', 15000),
  speakerSettleMs: num('SPEAKER_SETTLE_MS', 400),
  leadingSilenceMs: num('LEADING_SILENCE_MS', 300),
  trailingSilenceMs: num('TRAILING_SILENCE_MS', 700),
  maxSessionMs: num('MAX_SESSION_MS', 25000),
  snapshotUuidWaitBatteryMs: num('SNAPSHOT_UUID_WAIT_BATTERY_MS', 2000),
  snapshotUuidWaitWiredMs: num('SNAPSHOT_UUID_WAIT_WIRED_MS', 500),
  snapshotUuidToleranceMs: num('SNAPSHOT_UUID_TOLERANCE_MS', 2000),
  snapshotRouteTimeoutMs: num('SNAPSHOT_ROUTE_TIMEOUT_MS', 4000),
  keyframeTimeoutMs: num('KEYFRAME_TIMEOUT_MS', 10000),
}

export function measurementPath(...parts) {
  const full = path.join(MEASUREMENTS_DIR, ...parts)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  return full
}

const OUTPUTS = ['bluetooth', 'doorbell', 'both']
if (!OUTPUTS.includes(config.output)) {
  throw new Error(`OUTPUT must be one of ${OUTPUTS.join(', ')}, got "${config.output}"`)
}
