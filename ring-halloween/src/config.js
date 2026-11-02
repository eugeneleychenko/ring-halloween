import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ASSETS_DIR = path.join(ROOT, 'assets')

// A setting in ring-halloween/.env wins over the same one in the folder above it.
// Test runs use the defaults, so that tonight's settings can't change what they check.
for (const envFile of process.env.NODE_TEST_CONTEXT ? [] : [path.join(ROOT, '.env'), path.join(ROOT, '..', '.env')]) {
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
}

// Test runs must never touch the real logs, token or clips, however they are started.
const testDir = process.env.NODE_TEST_CONTEXT ? fs.mkdtempSync(path.join(os.tmpdir(), 'ring-halloween-test-')) : null
const baseDir = testDir ?? ROOT

export const TOKEN_DIR = process.env.RING_TOKEN_DIR || baseDir
export const MEASUREMENTS_DIR = process.env.MEASUREMENTS_DIR || path.join(baseDir, 'measurements')
export const CLIPS_DIR = process.env.CLIPS_DIR || path.join(baseDir, 'clips')
export const SNAPSHOTS_DIR = process.env.SNAPSHOTS_DIR || path.join(baseDir, 'snapshots')

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
  // The owner's open decisions (docs/personality.md section 5). Each is a one-line change in .env.
  characterName: process.env.CHARACTER_NAME || 'Malyx',
  skipBehavior: process.env.SKIP_BEHAVIOR || 'silence',
  signOff: process.env.SIGN_OFF === 'true',
  coverClip: process.env.COVER_CLIP !== 'false',
  geminiBillingConfirmed: process.env.GEMINI_BILLING_CONFIRMED === 'true',
  // 'best' sends the later frame alone. In early tests, sending both caused wrong SKIPs.
  geminiFrames: process.env.GEMINI_FRAMES || 'best',
  geminiPrompt: process.env.GEMINI_PROMPT || 'plain',
  geminiCrop: process.env.GEMINI_CROP || null,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  geminiThinkingLevel: process.env.GEMINI_THINKING_LEVEL || 'minimal',
  geminiMediaResolution: process.env.GEMINI_MEDIA_RESOLUTION || 'low',
  geminiImageMaxPx: num('GEMINI_IMAGE_MAX_PX', 768),
  geminiTemperature: num('GEMINI_TEMPERATURE', 0.6),
  geminiMaxOutputTokens: num('GEMINI_MAX_OUTPUT_TOKENS', 120),
  geminiTimeoutMs: num('GEMINI_TIMEOUT_MS', 2500),
  geminiWarmupMs: num('GEMINI_WARMUP_MS', 300000),
  elevenLabsBaseUrl: process.env.ELEVENLABS_BASE_URL || 'https://api.us.elevenlabs.io',
  elevenLabsModel: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
  ttsStability: num('TTS_STABILITY', 0.55),
  ttsSimilarityBoost: num('TTS_SIMILARITY_BOOST', 0.8),
  ttsStyle: num('TTS_STYLE', 0),
  ttsSpeed: num('TTS_SPEED', 0.92),
  ttsSpeakerBoost: process.env.TTS_SPEAKER_BOOST !== 'false',
  ttsUsePvcAsIvc: process.env.TTS_USE_PVC_AS_IVC === 'true',
  ttsHighpassHz: num('TTS_HIGHPASS_HZ', 200),
  ttsPresenceDb: num('TTS_PRESENCE_DB', 0),
  ttsLeadingSilenceMs: num('TTS_LEADING_SILENCE_MS', 300),
  ttsTimeoutMs: num('TTS_TIMEOUT_MS', 5000),
  bluetoothSpeakerName: process.env.BLUETOOTH_SPEAKER_NAME || null,
  bluetoothSpeakerAddress: process.env.BLUETOOTH_SPEAKER_ADDRESS || null,
  bluetoothVolume: process.env.BLUETOOTH_VOLUME === 'unchanged' ? null : num('BLUETOOTH_VOLUME', 80),
  bluetoothKeepAliveMs: num('BLUETOOTH_KEEPALIVE_MS', 120000),
  bluetoothHealthCheckMs: num('BLUETOOTH_HEALTH_CHECK_MS', 30000),
  deviceName: process.env.RING_DEVICE_NAME || null,
  deviceId: process.env.RING_DEVICE_ID || null,
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  cooldownMs: num('COOLDOWN_MS', 10000),
  cameraConnectedTimeoutMs: num('CAMERA_CONNECTED_TIMEOUT_MS', 15000),
  opusBitrate: process.env.OPUS_BITRATE || null,
  pacedSend: process.env.PACED_SEND !== 'false',
  doorbellVideoOff: process.env.DOORBELL_VIDEO_OFF === 'true',
  speakerSettleMs: num('SPEAKER_SETTLE_MS', 400),
  trailingSilenceMs: num('TRAILING_SILENCE_MS', 700),
  maxSessionMs: num('MAX_SESSION_MS', 25000),
  snapshotUuidWaitBatteryMs: num('SNAPSHOT_UUID_WAIT_BATTERY_MS', 2000),
  snapshotUuidWaitWiredMs: num('SNAPSHOT_UUID_WAIT_WIRED_MS', 500),
  snapshotUuidToleranceMs: num('SNAPSHOT_UUID_TOLERANCE_MS', 2000),
  closerFrame: process.env.CLOSER_FRAME !== 'false',
  closerFrameDelayMs: num('CLOSER_FRAME_DELAY_MS', 2000),
  closerFrameWaitMs: num('CLOSER_FRAME_WAIT_MS', 5000),
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
