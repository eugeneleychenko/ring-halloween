import { spawn } from 'node:child_process'
import dgram from 'node:dgram'
import { Readable } from 'node:stream'
import { RtpPacket } from 'werift'
import { config } from '../config.js'

const SAMPLE_RATE = 48000
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000
const FRAME_MS = 20
const FRAME_BYTES = FRAME_MS * BYTES_PER_MS
const LEAD_MS = 40
const MAX_CATCH_UP_MS = 200
const SILENCE_FRAME = Buffer.alloc(FRAME_BYTES)

const silence = (ms) => Buffer.alloc(Math.round(ms * BYTES_PER_MS / 2) * 2)

export function encoderArgs(usingOpus, port) {
  return [
    '-hide_banner', '-loglevel', 'error',
    // ffmpeg treats -analyzeduration 0 as "use the 5 s default", which holds back the first
    // 4 s of audio while it probes. Raw PCM has nothing to probe, so keep this minimal.
    '-fflags', '+nobuffer', '-probesize', '32', '-analyzeduration', '1000',
    '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0',
    ...(usingOpus
      ? ['-acodec', 'libopus', '-ac', '2', '-ar', '48k', '-frame_duration', String(FRAME_MS)]
      // 160 samples is the standard 20 ms PCMU packet; ffmpeg would otherwise send 128 ms ones.
      : ['-af', 'aresample=8000,asetnsamples=n=160:p=0', '-acodec', 'pcm_mulaw', '-ac', '1', '-ar', '8k']),
    '-flags', '+global_header',
    '-flush_packets', '1',
    '-f', 'rtp', `rtp://127.0.0.1:${port}`,
  ]
}

/**
 * Keeps one encoder running for the whole call and feeds it PCM in real time,
 * silence when nothing is queued. Ring ends a call when its return-audio ffmpeg
 * exits, and ffmpeg's `-re` bursts to catch up after any input gap, so a cover clip
 * then a comment have to be one continuous input with Node doing the pacing.
 */
export class RtpPlayer {
  constructor({
    sendRtp,
    usingOpus,
    ffmpegPath = config.ffmpegPath,
    leadingSilenceMs = config.leadingSilenceMs,
    trailingSilenceMs = config.trailingSilenceMs,
    onFatal = () => {},
    now = Date.now,
  }) {
    Object.assign(this, { sendRtp, usingOpus, ffmpegPath, leadingSilenceMs, trailingSilenceMs, onFatal, now })
    this.queue = []
    this.pending = Buffer.alloc(0)
    this.stats = { rtpPackets: 0, firstRtpAt: null, underruns: 0, framesWritten: 0, stderr: '' }
    this.stopped = false
  }

  async start() {
    this.socket = dgram.createSocket('udp4')
    this.socket.on('message', (message) => this.#onRtp(message))
    await new Promise((resolve, reject) => {
      this.socket.once('error', reject)
      this.socket.bind(0, '127.0.0.1', resolve)
    })
    const { port } = this.socket.address()
    this.encoder = spawn(this.ffmpegPath, encoderArgs(this.usingOpus, port), {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    this.encoder.stderr.on('data', (chunk) => {
      this.stats.stderr = (this.stats.stderr + chunk).slice(-2000)
    })
    this.encoder.stdin.on('error', () => {})
    this.encoder.on('error', (error) => this.#fail(error))
    this.encoder.on('exit', (code, signal) => {
      if (!this.stopped) {
        this.#fail(new Error(`Audio encoder exited (code ${code}, signal ${signal}): ${this.stats.stderr.trim()}`))
      }
    })
    this.startedAt = this.now()
    this.bytesWritten = 0
    this.pacer = setInterval(() => this.#tick(), 10)
    this.#tick()
  }

  /**
   * Queue a clip. It plays once every clip queued before it has finished, with no
   * gap in the RTP stream. `source` is a file path or a readable stream of anything
   * ffmpeg can decode, and a stream can start playing before it has finished arriving.
   */
  play(source) {
    if (this.stopped) return Promise.reject(new Error('Player is stopped'))
    return new Promise((resolve, reject) => {
      const clip = {
        chunks: [silence(this.leadingSilenceMs)],
        decoded: false,
        audioBytes: 0,
        firstAudioAt: null,
        startedAt: null,
        rtpPackets: 0,
        leadingBytes: silence(this.leadingSilenceMs).length,
        sentBytes: 0,
        resolve,
        reject,
      }
      this.queue.push(clip)
      this.#decode(source, clip)
    })
  }

  #decode(source, clip) {
    const isStream = source instanceof Readable
    const decoder = spawn(
      this.ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-i', isStream ? 'pipe:0' : String(source), '-vn', '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE), 'pipe:1'],
      { stdio: [isStream ? 'pipe' : 'ignore', 'pipe', 'pipe'] },
    )
    clip.decoder = decoder
    let stderr = ''
    decoder.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-1000) })
    decoder.stdout.on('data', (chunk) => {
      clip.chunks.push(chunk)
      clip.audioBytes += chunk.length
    })
    if (isStream) {
      decoder.stdin.on('error', () => {})
      source.on('error', () => decoder.stdin.destroy())
      source.pipe(decoder.stdin)
    }
    decoder.on('error', (error) => this.#failClip(clip, error))
    decoder.on('close', (code) => {
      if (code !== 0 || clip.audioBytes === 0) {
        if (!this.stopped) this.#failClip(clip, new Error(`Could not decode clip: ${stderr.trim() || `ffmpeg code ${code}`}`))
        return
      }
      clip.chunks.push(silence(this.trailingSilenceMs))
      clip.decoded = true
    })
  }

  #failClip(clip, error) {
    const index = this.queue.indexOf(clip)
    if (index >= 0) this.queue.splice(index, 1)
    if (this.current === clip) {
      this.current = null
      this.pending = Buffer.alloc(0)
    }
    clip.reject(error)
  }

  #nextFrame() {
    if (!this.current) {
      this.current = this.queue[0] ?? null
      if (this.current) {
        this.current.startedAt = this.now()
        this.pending = Buffer.alloc(0)
      }
    }
    const clip = this.current
    if (!clip) return SILENCE_FRAME
    while (this.pending.length < FRAME_BYTES && clip.chunks.length) {
      this.pending = Buffer.concat([this.pending, clip.chunks.shift()])
    }
    if (this.pending.length >= FRAME_BYTES || (clip.decoded && this.pending.length > 0)) {
      let frame = this.pending.subarray(0, FRAME_BYTES)
      this.pending = this.pending.subarray(frame.length)
      if (frame.length < FRAME_BYTES) frame = Buffer.concat([frame, SILENCE_FRAME.subarray(frame.length)])
      clip.sentBytes += FRAME_BYTES
      if (!clip.firstAudioAt && clip.sentBytes > clip.leadingBytes) clip.firstAudioAt = this.now()
      return frame
    }
    if (clip.decoded) {
      this.#finishClip(clip)
      return this.#nextFrame()
    }
    // A clip still arriving from a stream ran dry: stay continuous with silence.
    if (clip.startedAt) this.stats.underruns++
    return SILENCE_FRAME
  }

  #finishClip(clip) {
    this.queue.shift()
    this.current = null
    clip.resolve({
      startedAt: clip.startedAt,
      firstAudioAt: clip.firstAudioAt,
      finishedAt: this.now(),
      audioMs: Math.round(clip.audioBytes / BYTES_PER_MS),
      rtpPackets: clip.rtpPackets,
      rtpExpected: Math.round(clip.sentBytes / FRAME_BYTES),
    })
  }

  #tick() {
    if (this.stopped) return
    const elapsedMs = this.now() - this.startedAt
    let behindMs = elapsedMs + LEAD_MS - this.bytesWritten / BYTES_PER_MS
    // After a stalled event loop, skip ahead. Sending the backlog would burst audio.
    if (behindMs > MAX_CATCH_UP_MS) {
      this.bytesWritten += (behindMs - LEAD_MS) * BYTES_PER_MS
      behindMs = LEAD_MS
    }
    while (behindMs >= FRAME_MS) {
      this.encoder.stdin.write(this.#nextFrame())
      this.stats.framesWritten++
      this.bytesWritten += FRAME_BYTES
      behindMs -= FRAME_MS
      if (this.stopped) return
    }
  }

  #onRtp(message) {
    this.stats.rtpPackets++
    if (!this.stats.firstRtpAt) this.stats.firstRtpAt = this.now()
    if (this.current) this.current.rtpPackets++
    this.sendRtp(RtpPacket.deSerialize(message))
  }

  #fail(error) {
    if (this.stopped) return
    this.stop(error)
    this.onFatal(error)
  }

  stop(error = new Error('Playback stopped before the clip finished')) {
    if (this.stopped) return
    this.stopped = true
    clearInterval(this.pacer)
    for (const clip of this.queue) {
      clip.decoder?.kill('SIGKILL')
      clip.reject(error)
    }
    this.queue = []
    this.current = null
    this.encoder?.stdin.end()
    this.encoder?.kill('SIGKILL')
    this.socket?.close()
  }
}
