import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ASSETS_DIR, config, measurementPath } from '../config.js'
import { appendCsvRow } from '../csv.js'

export const BLUETOOTH_LOG_COLUMNS = ['at', 'kind', 'device', 'detail', 'command_ms', 'duration_ms']

const CALL_QUALITY_MAX_HZ = 16000

// macOS lists a Bluetooth speaker twice, as a mic and as an output, each with its own
// rate. The mic always reads 8000, so only the entry with output channels counts.
export function sampleRateOf(report, deviceName) {
  const lines = report.split('\n')
  for (let start = 0; start < lines.length; start++) {
    if (lines[start].trim() !== `${deviceName}:`) continue
    const indent = lines[start].search(/\S/)
    let rate = null
    let isOutput = false
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].trim() && lines[i].search(/\S/) <= indent) break
      if (/Output Channels:/.test(lines[i])) isOutput = true
      const match = lines[i].match(/Current SampleRate:\s*(\d+)/)
      if (match) rate = Number(match[1])
    }
    if (isOutput) return rate
  }
  return null
}

function runTool(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} failed: ${stderr.trim() || error.message}`))
      else resolve(stdout.trim())
    })
  })
}

function defaultPlayer(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('afplay', [file], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`afplay exited with code ${code}`))))
  })
}

/**
 * Plays clips on the outdoor speaker and keeps it working all evening. Clips carry
 * their own lead-in, so this adds none. Plays run one at a time, so that a cover clip
 * and then a comment can never overlap. If the speaker is gone, audio falls back to
 * the Mac's own speaker with a warning, because a voice at the door beats silence.
 */
export function createBluetoothOutput({
  speakerName = config.bluetoothSpeakerName,
  speakerAddress = config.bluetoothSpeakerAddress,
  run = runTool,
  player = defaultPlayer,
  log = console.warn,
  now = Date.now,
  keepAliveMs = config.bluetoothKeepAliveMs,
  healthCheckMs = config.bluetoothHealthCheckMs,
  volume = config.bluetoothVolume,
  reconnectDelaysMs = [5000, 15000, 30000, 60000],
  connectSettleMs = 8000,
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.() }),
  keepAliveFile = path.join(ASSETS_DIR, 'keepalive.wav'),
  writeLog = (row) => appendCsvRow(measurementPath('bluetooth.csv'), BLUETOOTH_LOG_COLUMNS, row),
} = {}) {
  let queue = Promise.resolve()
  let playing = 0
  let reconnecting = null
  let stopped = false
  const timers = []
  const record = (kind, device, detail = '', extra = {}) => writeLog({ at: new Date(now()).toISOString(), kind, device, detail, ...extra })
  const warn = (kind, device, detail) => {
    log(`[bluetooth] ${detail}`)
    record(kind, device, detail)
  }

  const listOutputs = async () => (await run('SwitchAudioSource', ['-a', '-t', 'output'])).split('\n').map((line) => line.trim()).filter(Boolean)
  const currentOutput = () => run('SwitchAudioSource', ['-c', '-t', 'output'])
  const setOutput = (device) => run('SwitchAudioSource', ['-s', device, '-t', 'output'])

  // macOS sometimes makes the speaker's own mic the default input when it connects,
  // which silently drops the speaker to 8 kHz call quality. Keep the input off it.
  async function pinInput(currentInput) {
    if (currentInput !== speakerName) return
    const inputs = (await run('SwitchAudioSource', ['-a', '-t', 'input'])).split('\n').map((line) => line.trim())
    const mic = inputs.find((name) => name && name !== speakerName)
    if (!mic) {
      warn('input_stuck', speakerName, `The default input is "${speakerName}" and no other mic exists: expect call-quality audio`)
      return
    }
    warn('input_corrected', mic, `Default input was the speaker's mic, which forces call quality. Switching to "${mic}"`)
    await run('SwitchAudioSource', ['-s', mic, '-t', 'input'])
  }

  const currentInput = () => run('SwitchAudioSource', ['-c', '-t', 'input'])

  async function setVolume() {
    if (volume !== null) await run('osascript', ['-e', `set volume output volume ${volume}`])
  }

    async function checkSampleRate() {
    const report = await run('system_profiler', ['SPAudioDataType'])
    const rate = sampleRateOf(report, speakerName)
    if (rate !== null && rate <= CALL_QUALITY_MAX_HZ) {
      warn('call_quality', speakerName, `Speaker is at ${rate} Hz call quality, fixing the input`)
      await pinInput(await currentInput())
    }
    return rate
  }

  const speakerListed = async () => (await listOutputs()).includes(speakerName)

  async function waitUntilListed() {
    // A successful connect takes a few seconds to show up as an audio output.
    const deadline = now() + connectSettleMs
    while (now() < deadline) {
      if (await speakerListed()) return true
      await sleep(Math.min(1000, connectSettleMs))
    }
    return speakerListed()
  }

  /**
   * Keeps trying in the background until the speaker returns, for as long as it takes.
   * A speaker can refuse a connect while it still thinks it is connected, so every
   * other try disconnects first. Nothing ever waits on this: visitors meanwhile get
   * the Mac speaker.
   */
  function startReconnecting() {
    if (reconnecting) return reconnecting
    if (!speakerAddress) return Promise.resolve(false)
    const started = now()
    reconnecting = (async () => {
      for (let attempt = 0; !stopped; attempt++) {
        if (await speakerListed()) break
        record('reconnect_attempt', speakerName, `attempt ${attempt + 1}${attempt % 2 ? ', disconnecting first' : ''}`)
        try {
          if (attempt % 2) await run('blueutil', ['--disconnect', speakerAddress])
          await run('blueutil', ['--connect', speakerAddress])
          if (await waitUntilListed()) break
        } catch (error) {
          record('reconnect_failed', speakerName, error.message.split('\n')[0])
        }
        await sleep(reconnectDelaysMs[Math.min(attempt, reconnectDelaysMs.length - 1)])
      }
      if (stopped) return false
      await enqueue(pinOutput)
      record('reconnected', speakerName, `Back after ${Math.round((now() - started) / 1000)} s, output and input re-pinned`)
      return true
    })().catch((error) => {
      warn('reconnect_error', speakerName, error.message)
      return false
    }).finally(() => { reconnecting = null })
    return reconnecting
  }

  // macOS listing the speaker as an output is the test, since that is what audio needs.
  async function speakerAvailable() {
    return (await listOutputs()).includes(speakerName)
  }

  // Each tool takes about 100 ms and this runs before every play, so they run together.
  async function pinOutput() {
    const [outputs, current, input] = await Promise.all([listOutputs(), currentOutput(), currentInput()])
    const available = outputs.includes(speakerName)
    if (!available) startReconnecting()
    const device = available ? speakerName : outputs.find((name) => /speakers/i.test(name) && name !== speakerName)
    if (!device) throw new Error(`Neither "${speakerName}" nor a built-in speaker is available`)
    if (!available) warn('fallback', device, `"${speakerName}" is unreachable, playing on "${device}" and still trying to reconnect`)
    if (current !== device) {
      warn('output_corrected', device, `Output was "${current}", switching to "${device}"`)
      await setOutput(device)
      const verified = await currentOutput()
      if (verified !== device) throw new Error(`Could not switch output to "${device}", still "${verified}"`)
    }
    // After the switch, since macOS keeps a separate volume for each device.
    await Promise.all([pinInput(input), setVolume()])
    return device
  }

  async function toFile(input) {
    if (!(input instanceof Readable)) return { file: String(input), cleanup: () => {} }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-halloween-'))
    const file = path.join(dir, 'stream.wav')
    await pipeline(input, fs.createWriteStream(file))
    return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
  }

  function enqueue(job) {
    const result = queue.then(job, job)
    queue = result.catch(() => {})
    return result
  }

  function play(input) {
    const commandAt = now()
    return enqueue(async () => {
      playing++
      try {
        const device = await pinOutput()
        // Takes over 200 ms, so it runs alongside the play instead of delaying it. Any
        // problem gets logged and fixed by the end of this clip, in time for the next.
        checkSampleRate().catch((error) => warn('sample_rate_check_failed', device, error.message))
        const { file, cleanup } = await toFile(input)
        const startedAt = now()
        try {
          await player(file)
        } finally {
          cleanup()
        }
        const finishedAt = now()
        record('play', device, path.basename(file), { command_ms: startedAt - commandAt, duration_ms: finishedAt - startedAt })
        return { output: 'bluetooth', device, fallback: device !== speakerName, startedAt, firstAudioAt: startedAt, finishedAt }
      } finally {
        playing--
      }
    })
  }

  async function keepAlive() {
    if (playing) return
    try {
      await enqueue(async () => {
        if (await speakerAvailable()) {
          const device = await pinOutput()
          await player(keepAliveFile)
          record('keepalive', device)
        }
      })
    } catch (error) {
      warn('keepalive_failed', speakerName, error.message)
    }
  }

  async function healthCheck() {
    try {
      if (await speakerAvailable()) {
        const inputOnSpeaker = await currentInput() === speakerName
        if (inputOnSpeaker || await currentOutput() !== speakerName) await enqueue(pinOutput)
        await checkSampleRate()
        return true
      }
      if (!reconnecting) warn('speaker_lost', speakerName, `"${speakerName}" is gone, trying to reconnect`)
      startReconnecting()
      return false
    } catch (error) {
      warn('health_check_failed', speakerName, error.message)
      return false
    }
  }

  return {
    play,
    pinOutput,
    checkSampleRate,
    keepAlive,
    healthCheck,
    start() {
      timers.push(setInterval(keepAlive, keepAliveMs), setInterval(healthCheck, healthCheckMs))
      for (const timer of timers) timer.unref()
      return healthCheck()
    },
    whenReconnected: () => reconnecting ?? Promise.resolve(false),
    stop() {
      stopped = true
      for (const timer of timers.splice(0)) clearInterval(timer)
    },
  }
}
