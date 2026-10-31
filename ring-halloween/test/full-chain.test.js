import assert from 'node:assert/strict'
import test from 'node:test'
import { createTriggerGate, onTrigger } from '../src/pipeline.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const event = (type = 'motion') => ({ id: 'e1', type, receivedAt: Date.now(), triggeredAt: Date.now() - 300, eventAt: Date.now() - 300 })

function chain(overrides = {}) {
  const log = []
  let queue = Promise.resolve()
  const play = (clip) => {
    log.push(`queued ${clip}`)
    const result = queue.then(async () => {
      const firstAudioAt = Date.now()
      log.push(`start ${clip}`)
      await sleep(20)
      log.push(`end ${clip}`)
      return { firstAudioAt }
    })
    queue = result.catch(() => {})
    return result
  }
  const options = {
    log: () => {}, output: 'bluetooth', openSession: () => null, storeSnapshot: () => '/s.jpg',
    gate: createTriggerGate({ cooldownMs: 0 }), skipBehavior: 'silence', signOff: false, coverClip: true,
    snapshot: async () => { log.push('snapshot'); return { jpegBuffer: Buffer.from('x'), takenAt: Date.now(), source: 'uuid' } },
    comment: async () => { log.push('gemini'); await sleep(40); return { decision: 'COMMENT', comment: 'Nice witch!', costume: 'witch', source: 'model' } },
    speak: async () => { log.push('tts'); return 'comment.wav' },
    pickClip: (category) => `${category}.wav`,
    play,
    ...overrides,
  }
  return { log, options }
}

test('the cover starts before Gemini finishes, the comment follows it once with no overlap, all logged', async () => {
  const { log, options } = chain()
  const result = await onTrigger(event(), options)
  assert.equal(result.status, 'played')
  assert.ok(log.indexOf('start cover.wav') < log.indexOf('tts'), log.join(', '))
  assert.ok(log.indexOf('end cover.wav') < log.indexOf('start comment.wav'))
  assert.equal(log.filter((l) => l === 'start comment.wav').length, 1)
  const r = result.row
  assert.equal(r.cover_clip, 'cover.wav')
  assert.equal(r.comment_source, 'model')
  assert.equal(r.audio_path, 'comment.wav')
  assert.equal(r.snapshot_path, '/s.jpg')
  assert.equal(r.costume_label, 'witch')
  assert.ok(Date.parse(r.first_audio_at) < Date.parse(r.comment_at))
  for (const name of ['trigger_at', 'event_received_at', 'snapshot_at', 'snapshot_route', 'gemini_ms', 'gemini_decision', 'tts_ms', 'output', 'first_audio_at']) {
    assert.notEqual(r[name] ?? '', '', `${name} is empty`)
  }
  assert.equal(r.success, true)
})

test('SKIP plays only the cover by default, or a skip line when configured', async () => {
  const skip = async () => ({ decision: 'SKIP', comment: '', source: 'model' })
  const silent = chain({ comment: skip })
  const result = await onTrigger(event(), silent.options)
  assert.equal(result.status, 'skipped')
  assert.deepEqual(silent.log.filter((l) => l.startsWith('start')), ['start cover.wav'])
  assert.notEqual(result.row.first_audio_at ?? '', '')
  const line = chain({ comment: skip, skipBehavior: 'line' })
  await onTrigger(event(), line.options)
  assert.deepEqual(line.log.filter((l) => l.startsWith('start')), ['start cover.wav', 'start skip.wav'])
  const anyway = chain({ comment: skip, skipBehavior: 'fallback' })
  await onTrigger(event(), anyway.options)
  assert.deepEqual(anyway.log.filter((l) => l.startsWith('start')), ['start cover.wav', 'start fallback.wav'])
})

test('a snapshot failure still gets a stock comment, with the reason in error', async () => {
  const { options } = chain({
    snapshot: async () => { throw new Error('no image') },
    comment: async (jpeg) => { assert.equal(jpeg, null); return { decision: 'COMMENT', comment: 'stock', source: 'stock', reason: 'no_image' } },
  })
  const result = await onTrigger(event(), options)
  assert.equal(result.status, 'played')
  assert.match(result.row.error, /snapshot: no image/)
  assert.match(result.row.error, /stock line \(no_image\)/)
})

test('a TTS failure plays a fallback clip, with the reason in error', async () => {
  const { log, options } = chain({ speak: async () => { throw new Error('ElevenLabs HTTP 500') } })
  const result = await onTrigger(event(), options)
  assert.equal(result.status, 'played')
  assert.ok(log.includes('start fallback.wav'))
  assert.equal(result.row.comment_source, 'clip')
  assert.match(result.row.error, /tts: ElevenLabs HTTP 500/)
})

test('a failed cover does not stop the comment, and a total play failure never throws', async () => {
  const { log, options } = chain()
  const realPlay = options.play
  const result = await onTrigger(event(), { ...options, play: (clip) => (clip === 'cover.wav' ? Promise.reject(new Error('afplay broke')) : realPlay(clip)) })
  assert.equal(result.status, 'played')
  assert.ok(log.includes('start comment.wav'))
  assert.match(result.row.error, /cover: afplay broke/)
  const broken = await onTrigger(event(), { ...options, play: () => Promise.reject(new Error('no output')) })
  assert.equal(broken.status, 'failed')
  assert.match(broken.row.error, /no output/)
})

test('the gate stays shut until the cover has finished too, and a press uses its own line', async () => {
  const gate = createTriggerGate({ cooldownMs: 0 })
  const { options } = chain({ gate, comment: async () => ({ decision: 'SKIP', comment: '', source: 'model' }) })
  const running = onTrigger(event(), options)
  assert.equal((await onTrigger({ ...event(), id: 'e2' }, options)).status, 'suppressed')
  await running
  assert.equal(gate.tryEnter().allowed, true)
  const press = chain()
  await onTrigger(event('ding'), press.options)
  assert.ok(press.log.includes('start press.wav'))
})
