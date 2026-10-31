// Not issue #01 acceptance. Exercises the player, session and keyframe code against
// real ffmpeg and the real library StreamingSession, with no Ring connection.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import dgram from 'node:dgram'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { ReplaySubject, Subject } from 'rxjs'
import { StreamingSession } from 'ring-client-api/streaming/streaming-session'
import { RtpPacket } from 'werift'
import { ASSETS_DIR } from '../src/config.js'
import { RtpPlayer } from '../src/audio/rtp-player.js'
import { grabKeyframe, videoOnlySdp } from '../src/keyframe.js'
import { DoorbellSession, parseSdpCodecs } from '../src/live-session.js'

const CLIP = path.join(ASSETS_DIR, 'test-clip.wav')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const decodeMulaw = (byte) => {
  const u = ~byte & 0xff
  const magnitude = (((u & 0x0f) << 3) + 0x84) << ((u >> 4) & 7)
  return (u & 0x80 ? 0x84 - magnitude : magnitude - 0x84)
}

function shortClip(ms, freq = 1000) {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${ms / 1000}`, '-f', 'wav', 'pipe:1'], { maxBuffer: 1e8 })
  return out.stdout
}

test('two clips play in one continuous PCMU call, with silence around them and no encoder exit', async () => {
  const packets = []
  const player = new RtpPlayer({
    usingOpus: false,
    sendRtp: (rtp) => packets.push({ at: Date.now(), seq: rtp.header.sequenceNumber, payload: rtp.payload }),
    leadingSilenceMs: 300,
    trailingSilenceMs: 700,
    onFatal: (e) => assert.fail(e),
  })
  await player.start()
  await sleep(300)
  const pid = player.encoder.pid
  const [first, second] = await Promise.all([
    player.play(Readable.from(shortClip(500))),
    player.play(Readable.from(shortClip(500, 2000))),
  ])
  await sleep(200)
  assert.equal(player.encoder.pid, pid)
  assert.equal(player.encoder.exitCode, null, 'the encoder must outlive each clip')
  assert.ok(second.startedAt >= first.finishedAt, 'clips do not overlap')

  for (let i = 1; i < packets.length; i++) {
    assert.equal((packets[i - 1].seq + 1) & 0xffff, packets[i].seq, 'no lost or reordered RTP')
  }
  assert.ok(packets.every((p) => p.payload.length === 160), 'PCMU packets are 20 ms each')

  // Silence, tone, silence, tone, silence: the audio really is in the packets, in order.
  const loud = packets.map((p) => Math.max(...[...p.payload].map((b) => Math.abs(decodeMulaw(b)))) > 2000)
  const runs = loud.reduce((acc, v) => { if (acc.at(-1)?.v !== v) acc.push({ v, n: 0 }); acc.at(-1).n++; return acc }, [])
  const toneRuns = runs.filter((r) => r.v)
  assert.equal(toneRuns.length, 2, `tone bursts: ${JSON.stringify(runs)}`)
  for (const run of toneRuns) assert.ok(Math.abs(run.n * 20 - 500) < 80, `tone lasted ${run.n * 20} ms`)
  // Measured in the audio itself, not by the clock: 700 ms trail, then 300 ms lead.
  const gapMs = runs[runs.indexOf(toneRuns[1]) - 1].n * 20
  assert.ok(Math.abs(gapMs - 1000) <= 80, `silence between the clips was ${gapMs} ms`)
  player.stop()
})

test('Opus produces 20 ms packets that ffmpeg can decode', async () => {
  const packets = []
  const player = new RtpPlayer({ usingOpus: true, sendRtp: (rtp) => packets.push(rtp), leadingSilenceMs: 300, trailingSilenceMs: 700 })
  await player.start()
  const result = await player.play(CLIP)
  assert.ok(result.audioMs > 5000)
  assert.ok(result.rtpPackets / result.rtpExpected > 0.9, `${result.rtpPackets}/${result.rtpExpected} packets`)
  const stamps = packets.slice(1, 50).map((p, i) => (p.header.timestamp - packets[i].header.timestamp) >>> 0)
  assert.ok(stamps.every((d) => d === 960), `Opus timestamp steps: ${[...new Set(stamps)]}`)
  assert.ok(packets.some((p) => p.payload.length > 50), 'speech gives larger Opus packets')
  player.stop()
})

test('a broken clip fails that clip only, and the call carries on', async () => {
  const player = new RtpPlayer({ usingOpus: false, sendRtp: () => {}, onFatal: (e) => assert.fail(e) })
  await player.start()
  await assert.rejects(player.play('/does/not/exist.wav'), /Could not decode/)
  const ok = await player.play(Readable.from(shortClip(100)))
  assert.ok(ok.audioMs >= 90)
  player.stop()
})

test('stop() rejects a playing clip instead of leaving it hanging', async () => {
  const player = new RtpPlayer({ usingOpus: false, sendRtp: () => {} })
  await player.start()
  const playing = player.play(CLIP)
  await sleep(100)
  player.stop()
  await assert.rejects(playing, /stopped/)
})

const RING_SDP_OPUS = [
  'v=0', 'o=- 1 1 IN IP4 10.0.0.1', 's=-', 't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 0', 'c=IN IP4 0.0.0.0', 'a=rtpmap:111 opus/48000/2', 'a=rtpmap:0 PCMU/8000', 'a=sendrecv',
  'm=video 9 UDP/TLS/RTP/SAVPF 96', 'c=IN IP4 0.0.0.0', 'a=rtpmap:96 H264/90000', 'a=fmtp:96 packetization-mode=1', 'a=recvonly', '',
].join('\r\n')

test('parseSdpCodecs reports the codecs the doorbell chose', () => {
  assert.deepEqual(parseSdpCodecs(RING_SDP_OPUS), { audio: 'opus/48000/2', video: 'H264/90000' })
  assert.deepEqual(parseSdpCodecs('m=audio 9 RTP/AVP 0\na=rtpmap:0 PCMU/8000\n').audio, 'PCMU/8000')
})

function fakeConnection() {
  const sent = []
  return {
    onAudioRtp: new Subject(), onVideoRtp: new Subject(), onCallAnswered: new ReplaySubject(1),
    onCallEnded: new ReplaySubject(1), onError: new ReplaySubject(1), onCameraConnected: new ReplaySubject(1),
    onMessage: new ReplaySubject(), sent, packets: [], speakerActivated: 0, keyframes: 0, stopped: 0,
    activateCameraSpeaker() { this.speakerActivated++ },
    sendSessionMessage(method) { sent.push(method) },
    sendAudioPacket(rtp) { this.packets.push(rtp) },
    requestKeyFrame() { this.keyframes++ },
    stop() { this.stopped++; this.onCallEnded.next() },
  }
}

const cfg = { ffmpegPath: 'ffmpeg', leadingSilenceMs: 100, trailingSilenceMs: 100, speakerSettleMs: 50, maxSessionMs: 20000, cameraConnectedTimeoutMs: 1500 }

function fakeCamera(connection) {
  return { name: 'door', async startLiveCall() { return new StreamingSession(this, connection) } }
}

test('session against the real StreamingSession: timings, codec, pong, speaker, audio', async () => {
  const connection = fakeConnection()
  const session = new DoorbellSession(fakeCamera(connection), { cfg })
  await sleep(20)
  connection.onMessage.next({ method: 'ping', body: {} })
  connection.onCallAnswered.next(RING_SDP_OPUS)
  await sleep(50)
  assert.equal(session.marks.speaker_ready, undefined, 'not ready before camera_connected')
  connection.onCameraConnected.next()
  await session.whenReady()
  assert.equal(connection.speakerActivated, 1)
  assert.deepEqual(connection.sent, ['pong'])
  assert.equal(session.codec, 'opus/48000/2')
  assert.equal(session.videoCodec, 'H264/90000')
  assert.ok(session.marks.call_created <= session.marks.answered)
  assert.ok(session.marks.camera_connected <= session.marks.speaker_ready)
  const played = await session.play(Readable.from(shortClip(200)))
  assert.ok(played.rtpPackets > 0)
  assert.ok(connection.packets[0] instanceof RtpPacket)
  session.end('finished')
  assert.equal(connection.stopped, 1)
  assert.equal(session.endedEarly, false)
})

test('session reports a timeout if camera_connected never arrives', async () => {
  const connection = fakeConnection()
  const session = new DoorbellSession(fakeCamera(connection), { cfg: { ...cfg, cameraConnectedTimeoutMs: 300 } })
  await sleep(10)
  connection.onCallAnswered.next(RING_SDP_OPUS)
  await assert.rejects(session.whenReady(), /Speaker not ready/)
  assert.equal(connection.stopped, 1)
})

test('session reports a call that Ring ends early, and a Mode that blocks live view', async () => {
  const connection = fakeConnection()
  const session = new DoorbellSession(fakeCamera(connection), { cfg })
  await sleep(10)
  connection.onCallEnded.next()
  await assert.rejects(session.whenReady(), /Call ended before/)
  assert.equal(session.endedEarly, true)
  const blocked = new DoorbellSession({ startLiveCall: async () => { throw new Error('Live view is currently disabled') } }, { cfg })
  await assert.rejects(blocked.whenReady(), /Live view is currently disabled/)
})

test('a keyframe grab from an H.264 RTP stream returns a JPEG and leaves the call up', async () => {
  const connection = fakeConnection()
  const call = new StreamingSession({ name: 'door' }, connection)
  const socket = dgram.createSocket('udp4')
  socket.on('message', (m) => connection.onVideoRtp.next(RtpPacket.deSerialize(m)))
  await new Promise((r) => socket.bind(0, '127.0.0.1', r))
  const source = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15', '-c:v', 'libx264', '-profile:v', 'baseline', '-g', '15', '-pix_fmt', 'yuv420p', '-bf', '0', '-f', 'rtp', '-payload_type', '96', `rtp://127.0.0.1:${socket.address().port}`], { stdio: 'ignore' })
  connection.onCallAnswered.next(RING_SDP_OPUS)
  try {
    const started = Date.now()
    const frame = await grabKeyframe(call, { timeoutMs: 8000 })
    assert.equal(frame.jpegBuffer[0], 0xff)
    assert.equal(frame.jpegBuffer[1], 0xd8)
    assert.ok(frame.takenAt >= started)
    await sleep(100)
    assert.equal(connection.stopped, 0, 'grabbing a frame must not end the call')
    assert.ok(connection.keyframes >= 1)
  } finally {
    source.kill('SIGKILL')
    socket.close()
    call.stop()
  }
})

test('videoOnlySdp keeps only the video section, on the local port', () => {
  const sdp = videoOnlySdp(RING_SDP_OPUS, 5000)
  assert.match(sdp, /^m=video 5000 /)
  assert.ok(!sdp.includes('m=audio'))
  assert.throws(() => videoOnlySdp('v=0\nm=audio 9 RTP/AVP 0\n', 5000), /no video/)
})

