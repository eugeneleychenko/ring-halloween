import { config } from './config.js'
import { RtpPlayer } from './audio/rtp-player.js'

export function parseSdpCodecs(sdp) {
  const result = { audio: null, video: null }
  let media = null
  const firstPayload = {}
  for (const line of String(sdp).split(/\r?\n/)) {
    const mLine = line.match(/^m=(audio|video) \d+ \S+ (\d+)/)
    if (mLine) {
      media = mLine[1]
      firstPayload[media] = mLine[2]
      continue
    }
    if (line.startsWith('m=')) media = null
    const rtpmap = line.match(/^a=rtpmap:(\d+) (\S+)/)
    if (media && rtpmap && rtpmap[1] === firstPayload[media] && !result[media]) result[media] = rtpmap[2]
  }
  return result
}

const withTimeout = (promise, ms, message) => {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) }),
  ]).finally(() => clearTimeout(timer))
}

export class DoorbellSession {
  constructor(camera, { t0 = Date.now(), cfg = config, now = Date.now } = {}) {
    Object.assign(this, { camera, t0, cfg, now })
    this.marks = {}
    this.timeline = []
    this.codec = null
    this.videoCodec = null
    this.endedEarly = false
    this.endReason = null
    this.ended = false
    this.endedPromise = new Promise((resolve) => { this.resolveEnded = resolve })
    this.ready = this.#open()
    this.ready.catch(() => {})
  }

  mark(name) {
    if (this.marks[name] === undefined) this.marks[name] = this.now() - this.t0
    this.timeline.push({ ms: this.now() - this.t0, name })
  }

  async #open() {
    this.mark('start_call')
    const call = await this.camera.startLiveCall()
    this.call = call
    this.mark('call_created')
    const connection = call.connection
    const subs = (this.subscriptions = [])
    subs.push(connection.onMessage.subscribe((message) => {
      const text = message.body?.text
      this.timeline.push({ ms: this.now() - this.t0, name: `msg:${message.method}${text ? `:${text}` : ''}` })
      // npm 14.3.0 does not answer Ring's keepalive, so streams die at about 30 s.
      // This is the same reply as the fix on the library's main branch (PR #1834).
      if (message.method === 'ping') connection.sendSessionMessage('pong')
    }))
    const answered = new Promise((resolve) => {
      subs.push(connection.onCallAnswered.subscribe((sdp) => {
        this.mark('answered')
        this.sdp = sdp
        const codecs = parseSdpCodecs(sdp)
        this.codec = codecs.audio
        this.videoCodec = codecs.video
        resolve(sdp)
      }))
    })
    const cameraConnected = new Promise((resolve) => {
      subs.push(connection.onCameraConnected.subscribe(() => {
        this.mark('camera_connected')
        resolve()
      }))
    })
    const ended = new Promise((_, reject) => {
      subs.push(call.onCallEnded.subscribe(() => {
        this.mark('call_ended')
        if (!this.endReason) {
          this.endedEarly = true
          this.endReason = 'ended_by_ring_or_error'
        }
        this.#cleanup()
        reject(new Error(`Call ended before the speaker was ready (at ${this.marks.call_ended} ms)`))
      }))
    })
    ended.catch(() => {})
    this.maxTimer = setTimeout(() => this.end('max_session'), this.cfg.maxSessionMs)

    // Queued by the library until camera_connected. Audio sent before then is lost.
    call.activateCameraSpeaker()

    const steps = (async () => {
      await answered
      const usingOpus = await call.isUsingOpus
      // RTP starts flowing at answer time, so the encoder is warm when the speaker opens.
      this.player = new RtpPlayer({
        sendRtp: (rtp) => call.sendAudioPacket(rtp),
        usingOpus,
        ffmpegPath: this.cfg.ffmpegPath,
        leadingSilenceMs: this.cfg.leadingSilenceMs,
        trailingSilenceMs: this.cfg.trailingSilenceMs,
        onFatal: () => this.end('encoder_failed'),
      })
      await this.player.start()
      this.mark('encoder_started')
      await cameraConnected
      await new Promise((resolve) => setTimeout(resolve, this.cfg.speakerSettleMs))
      this.mark('speaker_ready')
    })()
    try {
      await withTimeout(
        Promise.race([steps, ended]),
        this.cfg.cameraConnectedTimeoutMs,
        `Speaker not ready after ${this.cfg.cameraConnectedTimeoutMs} ms (reached: ${Object.keys(this.marks).join(', ')})`,
      )
    } catch (error) {
      this.mark('open_failed')
      this.end('open_failed')
      throw error
    }
    return this
  }

  whenReady() {
    return this.ready
  }

  async play(source) {
    await this.ready
    return this.player.play(source)
  }

  #cleanup() {
    if (this.ended) return
    this.ended = true
    clearTimeout(this.maxTimer)
    this.player?.stop()
    for (const subscription of this.subscriptions ?? []) subscription.unsubscribe()
    this.resolveEnded()
    if (active === this) active = null
  }

  end(reason = 'finished') {
    if (this.ended) return
    if (!this.endReason) this.endReason = reason
    this.mark('end_requested')
    const call = this.call
    this.#cleanup()
    call?.stop()
  }
}

let active = null

export function getActiveSession() {
  return active
}

// Only one live call per doorbell, shared by the speaker and the keyframe grabber.
export function getOrOpenSession(camera, options) {
  if (!active) active = new DoorbellSession(camera, options)
  return active
}

export function endActiveSession(reason) {
  active?.end(reason)
}
