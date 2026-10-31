import { spawn } from 'node:child_process'
import dgram from 'node:dgram'
import { firstValueFrom } from 'rxjs'
import { config } from './config.js'

export function videoOnlySdp(sdp, port) {
  const video = String(sdp).split('\nm=').slice(1).map((s) => `m=${s}`).find((s) => s.startsWith('m=video'))
  if (!video) throw new Error('The call has no video track')
  return video.replace(/m=video \d+/, `m=video ${port}`)
}

/**
 * First keyframe from an open call, as JPEG. Uses its own ffmpeg, not
 * call.startTranscoding(): that one ends the whole call when ffmpeg exits, which
 * would hang up the speaker the moment one frame had been captured.
 */
export async function grabKeyframe(call, { ffmpegPath = config.ffmpegPath, timeoutMs = config.keyframeTimeoutMs, now = Date.now, signal } = {}) {
  const sdp = await firstValueFrom(call.connection.onCallAnswered)
  const port = await call.reservePort(1)
  const socket = dgram.createSocket('udp4')
  const ffmpeg = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-protocol_whitelist', 'pipe,udp,rtp,file,crypto',
    '-skip_frame', 'nokey',
    '-f', 'sdp', '-i', 'pipe:0',
    '-an', '-frames:v', '1', '-q:v', '2', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  ffmpeg.stdin.on('error', () => {})

  let subscription
  let keyframeRequests
  let timer
  try {
    return await new Promise((resolve, reject) => {
      const chunks = []
      let stderr = ''
      ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk))
      ffmpeg.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-1000) })
      ffmpeg.on('error', reject)
      ffmpeg.on('close', (code) => {
        const jpegBuffer = Buffer.concat(chunks)
        if (jpegBuffer.length > 2 && jpegBuffer[0] === 0xff && jpegBuffer[1] === 0xd8) {
          resolve({ jpegBuffer, takenAt: now() })
        } else {
          reject(new Error(`No frame from the live stream (ffmpeg code ${code}): ${stderr.trim()}`))
        }
      })
      timer = setTimeout(() => reject(new Error(`No keyframe within ${timeoutMs} ms`)), timeoutMs)
      signal?.addEventListener('abort', () => reject(new Error('Not needed: another route won')), { once: true })
      subscription = call.onVideoRtp.subscribe((rtp) => {
        socket.send(rtp.serialize(), port, '127.0.0.1', () => {})
      })
      ffmpeg.stdin.end(videoOnlySdp(sdp, port))
      call.requestKeyFrame()
      keyframeRequests = setInterval(() => call.requestKeyFrame(), 500)
    })
  } finally {
    clearTimeout(timer)
    clearInterval(keyframeRequests)
    subscription?.unsubscribe()
    socket.close()
    ffmpeg.kill('SIGKILL')
  }
}
