import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { CLIPS_DIR, config, measurementPath } from './config.js'
import { appendCsvRow } from './csv.js'

const LOG_COLUMNS = ['at', 'chars', 'words', 'model', 'use_pvc_as_ivc', 'cached', 'api_ms', 'normalize_ms', 'total_ms', 'ok', 'error']
const FILE_FORMAT = 'wav_24000'
const STREAM_FORMAT = 'pcm_24000'
const SAMPLE_RATE = 24000
const DOORBELL_TRUE_PEAK_DB = -0.5

export function voiceRequest(text, cfg = config) {
  return {
    text,
    model_id: cfg.elevenLabsModel,
    voice_settings: {
      stability: cfg.ttsStability,
      similarity_boost: cfg.ttsSimilarityBoost,
      style: cfg.ttsStyle,
      use_speaker_boost: cfg.ttsSpeakerBoost,
      speed: cfg.ttsSpeed,
    },
    ...(cfg.ttsUsePvcAsIvc ? { use_pvc_as_ivc: true } : {}),
  }
}

function ttsUrl(cfg, stream, format) {
  return `${cfg.elevenLabsBaseUrl}/v1/text-to-speech/${cfg.elevenLabsVoiceId}${stream ? '/stream' : ''}?output_format=${format}`
}

async function requestSpeech(text, { cfg, stream, format, fetchImpl }) {
  if (!cfg.elevenLabsApiKey || !cfg.elevenLabsVoiceId) throw new Error('ElevenLabs key or voice ID is not set')
  const response = await fetchImpl(ttsUrl(cfg, stream, format), {
    method: 'POST',
    headers: { 'xi-api-key': cfg.elevenLabsApiKey, 'content-type': 'application/json' },
    body: JSON.stringify(voiceRequest(text, cfg)),
    signal: AbortSignal.timeout(cfg.ttsTimeoutMs),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`ElevenLabs HTTP ${response.status}: ${detail.slice(0, 200)}`)
  }
  return response
}

function runFfmpeg(args, { ffmpegPath = config.ffmpegPath, input } = {}) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, ['-hide_banner', ...args], { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] })
    let stderr = ''
    ffmpeg.stderr.on('data', (chunk) => { stderr += chunk })
    ffmpeg.on('error', reject)
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(stderr)
      else reject(new Error(`ffmpeg failed: ${stderr.slice(-400).trim()}`))
    })
    if (input) ffmpeg.stdin.end(input)
  })
}

// The compressor tames the voice's peaks. Without it, peaky lines hit the -1 dBTP
// ceiling and stop as low as -19 LUFS, so some lines would be far quieter than others.
const COMPRESSOR = 'acompressor=threshold=-30dB:ratio=5:attack=3:release=100:makeup=8'
function clipShape(cfg) {
  return [
    `highpass=f=${cfg.ttsHighpassHz}`,
    ...(cfg.ttsPresenceDb ? [`equalizer=f=3000:t=o:w=1.5:g=${cfg.ttsPresenceDb}`] : []),
    COMPRESSOR,
  ]
}

/**
 * Two-pass loudnorm to -14 LUFS, -1 dBTP: single-pass badly misses on clips this
 * short. Leading silence goes in last so that it doesn't dilute the measurement.
 * TTS_PRESENCE_DB adds a 3 kHz lift if the voice's built-in reverb blurs consonants.
 */
export async function normalizeClip(inputPath, outputPath, cfg = config) {
  const shape = clipShape(cfg)
  const target = 'I=-14:TP=-1:LRA=11'
  const measured = await runFfmpeg([
    '-nostats', '-i', inputPath,
    '-af', [...shape, `loudnorm=${target}:print_format=json`].join(','),
    '-f', 'null', '-',
  ], { ffmpegPath: cfg.ffmpegPath })
  const stats = JSON.parse(measured.slice(measured.lastIndexOf('{'), measured.lastIndexOf('}') + 1))
  // Near-silence gives "-inf" and can't be normalised; fall through to dynamic mode.
  const usable = [stats.input_i, stats.input_tp, stats.input_lra, stats.input_thresh].every((v) => Number.isFinite(Number(v)))
  const second = usable
    ? `loudnorm=${target}:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`
    : `loudnorm=${target}`
  const tmp = `${outputPath}.${process.pid}.tmp.wav`
  await runFfmpeg([
    '-loglevel', 'error', '-y', '-i', inputPath,
    '-af', [...shape, second, `adelay=${cfg.ttsLeadingSilenceMs}:all=1`].join(','),
    '-ar', String(SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le', tmp,
  ], { ffmpegPath: cfg.ffmpegPath })
  fs.renameSync(tmp, outputPath)
}

/**
 * A louder, more forward copy for the doorbell's small speaker only, leaving the
 * -14 LUFS clip untouched for Bluetooth. Made once per clip and reused.
 */
export async function masterForDoorbell(inputPath, { ffmpegPath = config.ffmpegPath } = {}) {
  const output = inputPath.replace(/\.wav$/, '.doorbell.wav')
  if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= fs.statSync(inputPath).mtimeMs) return output
  const shape = [
    'highpass=f=150',
    'equalizer=f=3000:t=o:w=1.5:g=4',
    'acompressor=threshold=-32dB:ratio=6:attack=3:release=80:makeup=10',
  ]
  // loudnorm alone stalls near -13 LUFS at the peak ceiling, so push the level into a
  // limiter instead. The extra 2 dB allows for what the limiter takes back.
  const measured = await runFfmpeg(['-nostats', '-i', inputPath, '-af', [...shape, 'loudnorm=I=-11:TP=-0.5:print_format=json'].join(','), '-f', 'null', '-'], { ffmpegPath })
  const stats = JSON.parse(measured.slice(measured.lastIndexOf('{'), measured.lastIndexOf('}') + 1))
  const gainDb = (-11 - Number(stats.input_i) + 2).toFixed(1)
  const tmp = `${output}.${process.pid}.tmp.wav`
  await runFfmpeg(['-loglevel', 'error', '-y', '-i', inputPath, '-af', [...shape, `volume=${gainDb}dB`, 'alimiter=limit=0.8:attack=2:release=40:level=false'].join(','), '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', tmp], { ffmpegPath })
  // The limiter can still overshoot between samples, so measure the true peak and trim
  // whatever is over the ceiling. Overs could clip in the decoder and sound like crackle.
  const summary = (await runFfmpeg(['-nostats', '-i', tmp, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { ffmpegPath })).split('Summary:').at(-1)
  const truePeak = Number(summary.match(/Peak:\s+(-?[\d.]+)/)?.[1])
  if (!Number.isFinite(truePeak)) throw new Error('Could not measure the true peak of the mastered clip')
  if (truePeak > DOORBELL_TRUE_PEAK_DB) {
    const trimDb = (DOORBELL_TRUE_PEAK_DB - truePeak - 0.1).toFixed(2)
    const trimmed = `${output}.${process.pid}.trim.wav`
    await runFfmpeg(['-loglevel', 'error', '-y', '-i', tmp, '-af', `volume=${trimDb}dB`, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', trimmed], { ffmpegPath })
    fs.renameSync(trimmed, tmp)
  }
  fs.renameSync(tmp, output)
  return output
}

export function clipKey(text, cfg = config) {
  const identity = JSON.stringify([cfg.elevenLabsVoiceId, voiceRequest(text, cfg), clipShape(cfg), cfg.ttsLeadingSilenceMs])
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20)
}

function logTts(row) {
  appendCsvRow(measurementPath('tts.csv'), LOG_COLUMNS, { at: new Date().toISOString(), ...row })
}

async function generateClip(text, outputPath, { cfg, fetchImpl }) {
  const started = Date.now()
  const response = await requestSpeech(text, { cfg, stream: false, format: FILE_FORMAT, fetchImpl })
  const raw = Buffer.from(await response.arrayBuffer())
  const apiMs = Date.now() - started
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const rawPath = `${outputPath}.${process.pid}.raw.wav`
  fs.writeFileSync(rawPath, raw)
  try {
    const normalizeStarted = Date.now()
    await normalizeClip(rawPath, outputPath, cfg)
    return { apiMs, normalizeMs: Date.now() - normalizeStarted }
  } finally {
    fs.rmSync(rawPath, { force: true })
  }
}

function findBankClip(text, cfg, clipsDir) {
  const manifestFile = path.join(clipsDir, 'manifest.json')
  if (!fs.existsSync(manifestFile)) return null
  const key = clipKey(text, cfg)
  for (const clips of Object.values(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).categories ?? {})) {
    const match = clips.find((clip) => clip.key === key)
    if (match && fs.existsSync(path.join(clipsDir, match.file))) return path.join(clipsDir, match.file)
  }
  return null
}

/**
 * Text to a normalised WAV, returning its path. Identical lines come from the cache:
 * this voice bills 3x credits per character, and a cached line takes no time at all.
 */
export async function synthesize(text, { cfg = config, fetchImpl = fetch, clipsDir = CLIPS_DIR, useCache = true, outputPath } = {}) {
  const file = outputPath ?? path.join(clipsDir, 'cache', `${clipKey(text, cfg)}.wav`)
  const base = { chars: text.length, words: text.trim().split(/\s+/).length, model: cfg.elevenLabsModel, use_pvc_as_ivc: cfg.ttsUsePvcAsIvc }
  const started = Date.now()
  const bankClip = useCache && !outputPath ? findBankClip(text, cfg, clipsDir) : null
  if (bankClip) {
    logTts({ ...base, cached: true, api_ms: 0, normalize_ms: 0, total_ms: Date.now() - started, ok: true })
    return bankClip
  }
  if (useCache && fs.existsSync(file)) {
    logTts({ ...base, cached: true, api_ms: 0, normalize_ms: 0, total_ms: Date.now() - started, ok: true })
    return file
  }
  try {
    const { apiMs, normalizeMs } = await generateClip(text, file, { cfg, fetchImpl })
    logTts({ ...base, cached: false, api_ms: apiMs, normalize_ms: normalizeMs, total_ms: Date.now() - started, ok: true })
    return file
  } catch (error) {
    logTts({ ...base, cached: false, total_ms: Date.now() - started, ok: false, error: error.message })
    throw error
  }
}

export function wavHeader({ sampleRate = SAMPLE_RATE, dataBytes = 0xffffffff - 36 } = {}) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE((dataBytes + 36) >>> 0, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataBytes >>> 0, 40)
  return header
}

/**
 * Streaming variant for issue #10: audio starts playing before the whole line exists.
 * Returns a readable stream of WAV (a header, then PCM as it arrives) that the audio
 * player takes directly. It isn't loudness-normalised, since that needs the whole clip.
 */
export async function synthesizeStream(text, { cfg = config, fetchImpl = fetch } = {}) {
  const started = Date.now()
  const response = await requestSpeech(text, { cfg, stream: true, format: STREAM_FORMAT, fetchImpl })
  const stream = new PassThrough()
  stream.write(wavHeader())
  const info = { startedAt: started, firstByteMs: null }
  ;(async () => {
    for await (const chunk of response.body) {
      if (info.firstByteMs === null) info.firstByteMs = Date.now() - started
      if (!stream.write(chunk)) await new Promise((resolve) => stream.once('drain', resolve))
    }
    stream.end()
  })().catch((error) => stream.destroy(error))
  return { stream, info }
}
