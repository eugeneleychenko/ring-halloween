import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CLIP_LINES } from '../src/clip-lines.js'
import { createClipPicker } from '../src/clip-bank.js'
import { createTriggerGate, onTrigger } from '../src/pipeline.js'

const FALLBACK_LINES = CLIP_LINES.fallback
import { config, ASSETS_DIR } from '../src/config.js'
import { buildRequest, countWords, downscaleJpeg, generateComment, rejectReason, startGeminiWarmup } from '../src/gemini.js'
import { computeEvalMetrics } from '../src/gemini-eval.js'
import { clipKey, masterForDoorbell, normalizeClip, synthesize, voiceRequest, wavHeader } from '../src/tts.js'

const JPEG = fs.readFileSync(path.join(ASSETS_DIR, 'stub-snapshot.jpg'))
const cfg = { ...config, geminiApiKey: 'test-key', geminiBillingConfirmed: true, geminiTimeoutMs: 200 }
const quiet = { cfg, log: () => {} }
const reply = (object, status = 200) => async () => new Response(JSON.stringify(object), { status })
const modelSays = (obj, finishReason = 'STOP') => reply({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(obj) }] } }] })

test('the request carries the agreed model settings and decision comes first', () => {
  const body = buildRequest(JPEG, { ...config, geminiThinkingLevel: 'minimal', geminiMediaResolution: 'low' })
  const g = body.generationConfig
  assert.equal(g.thinkingConfig.thinkingLevel, 'minimal')
  assert.equal(g.mediaResolution, 'MEDIA_RESOLUTION_LOW')
  assert.deepEqual(g.responseSchema.propertyOrdering, ['decision', 'costume', 'comment'])
  assert.deepEqual(g.responseSchema.properties.decision.enum, ['COMMENT', 'SKIP'])
  assert.deepEqual(body.safetySettings.map((s) => [s.category, s.threshold]), [
    ['HARM_CATEGORY_HARASSMENT', 'BLOCK_LOW_AND_ABOVE'],
    ['HARM_CATEGORY_HATE_SPEECH', 'BLOCK_LOW_AND_ABOVE'],
  ])
  assert.equal(config.geminiModel, 'gemini-3.5-flash-lite')
})

test('the previous comment goes in the request so wording can vary', () => {
  const body = buildRequest(JPEG, config, { previousComment: 'Behold, a magnificent witch!' })
  assert.match(body.contents[0].parts[0].text, /previous line was: "Behold, a magnificent witch!"/)
  assert.ok(!buildRequest(JPEG, config).contents[0].parts[0].text.includes('previous'))
})

test('two frames go in order, with the later one marked as the costume view', async () => {
  const body = buildRequest([JPEG, JPEG], config)
  assert.equal(body.contents[0].parts.filter((p) => p.inlineData).length, 2)
  assert.match(body.contents[0].parts[0].text, /last image is later/)
  assert.ok(!buildRequest(JPEG, config).contents[0].parts[0].text.includes('last image'))
  let sent
  const result = await generateComment([JPEG, JPEG], { ...quiet, fetchImpl: async (u, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ decision: 'COMMENT', comment: 'A splendid pirate costume, ahoy there, friend!' }) }] } }] })) } })
  assert.equal(result.source, 'model')
  assert.equal(sent.contents[0].parts.filter((p) => p.inlineData).length, 2)
})

test('the specific prompt asks for observations first and is opt-in, with an optional crop', async () => {
  const plain = buildRequest(JPEG, config)
  assert.deepEqual(plain.generationConfig.responseSchema.propertyOrdering, ['decision', 'costume', 'comment'])
  const specific = buildRequest(JPEG, { ...config, geminiPrompt: 'specific' })
  assert.deepEqual(specific.generationConfig.responseSchema.propertyOrdering, ['decision', 'observations', 'costume', 'comment'])
  const text = specific.systemInstruction.parts[0].text
  assert.match(text, /MUST use at least one observation/)
  assert.match(text, /wand already raised/)
  assert.ok(!text.includes('overall spooky look'))
  assert.match(text, /Never: mention body/)
  const cropped = await downscaleJpeg(JPEG, { crop: '0.4,0.25,0.6,0.75' })
  const size = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', 'pipe:0'], { input: cropped, encoding: 'utf8' }).stdout.trim()
  assert.equal(size, '384,270')
})

test('images are downscaled to 768 px on the long side', async () => {
  const big = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { maxBuffer: 1e8 }).stdout
  const small = await downscaleJpeg(big)
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', 'pipe:0'], { input: small, encoding: 'utf8' }).stdout.trim()
  assert.equal(probe, '768,432')
})

for (const [text, reason] of [
  ['You look so old in that witch costume', 'forbidden:age'],
  ['What a great costume for a little girl', 'forbidden:age'],
  ['Love your long hair with that cape', 'forbidden:hair'],
  ['That costume hides your belly well', 'forbidden:body'],
  ['Your skin looks spooky tonight', 'forbidden:skin'],
  ['Such a pretty vampire you are tonight', 'forbidden:looks'],
  ['You look like Taylor Swift', 'forbidden:identity'],
  ['A costume perfect for an Asian warrior', 'forbidden:race'],
  ['What a nice man in a cape', 'forbidden:gender'],
  // docs/personality.md 2i
  ['Wow, you must be in kindergarten by now', 'forbidden:age'],
  ['Those glasses go well with your wizard robe', 'forbidden:face'],
  ["You're so pretty in that spooky costume", 'forbidden:looks'],
  ['I know who you are under there, friend', 'forbidden:identity'],
  ['I see you out there on my porch', 'forbidden:menace'],
  ["I'm watching you and your wonderful costume", 'forbidden:menace'],
  ["You can't hide from me tonight, brave ghost", 'forbidden:menace'],
  ["I've been waiting for you all night long", 'forbidden:menace'],
  ['Come closer so I can admire your cape', 'forbidden:menace'],
  ['Come inside and show me that costume', 'forbidden:menace'],
  ['What a fine night for blood and bones', 'forbidden:real scares'],
  ['A costume so good I could eat you up', 'forbidden:real scares'],
  ['Nobody wants to be alone in the dark', 'forbidden:real scares'],
  ['Did your mom make that excellent cape', 'forbidden:judging'],
  ['A great costume, but is it homemade', 'forbidden:judging'],
  ['Mind any allergies in your treats tonight', 'forbidden:candy'],
  ['A costume fit for the president tonight', 'forbidden:off limits'],
  ['Hooray for 3 wonderful spooky costumes', 'digit'],
  ['Great costume', 'too_short'],
  [Array(26).fill('spooky').join(' '), 'too_long'],
  ['   ', 'empty'],
]) {
  test(`post-filter rejects: ${text.slice(0, 40)}`, () => assert.equal(rejectReason(text), reason))
}

for (const text of [
  'What a great Spider-Man costume! Those webs look ready for a spooky night.',
  'Iron Man has arrived, and that armor is terrific!',
  'A golden crown and a bold cape, what a wonderful costume!',
  'RAAAWR! A dinosaur at my door! Millions of years late for the party, but right on time for candy.',
  'A witch, a firefighter, and a mystery! What a crew. Wonderful costumes, all of you.',
]) {
  test(`post-filter allows: ${text.slice(0, 40)}`, () => assert.equal(rejectReason(text), null))
}

test('post-filter rejects an exact repeat of the last spoken line', () => {
  const line = 'Wonderful witch costume, what a treat tonight!'
  assert.equal(rejectReason(line, { lastComment: line }), 'repeat')
  assert.equal(rejectReason(line, { lastComment: 'Something else entirely, friend.' }), null)
})

test('the clip picker is random but never repeats immediately', () => {
  const pick = createClipPicker({ categories: { cover: [{ file: 'a.wav' }, { file: 'b.wav' }, { file: 'c.wav' }] } }, { dir: '/clips' })
  let last = null
  for (let i = 0; i < 200; i++) {
    const clip = pick('cover')
    assert.notEqual(clip, last)
    last = clip
  }
  assert.equal(pick('missing'), null)
})

test('skip and sign-off defaults stay silent, and each is one setting away', async () => {
  const played = []
  const run = (options) => onTrigger({ id: 'e', receivedAt: 2, triggeredAt: 1 }, {
    log: () => {}, coverClip: false, storeSnapshot: null, openSession: () => null, output: 'bluetooth',
    gate: createTriggerGate({ cooldownMs: 0 }), snapshot: async () => ({ jpegBuffer: Buffer.from('x'), takenAt: 1 }),
    speak: async () => 'comment.wav', play: async (clip) => { played.push(clip); return {} }, pickClip: (category) => `${category}.wav`, ...options,
  })
  const skip = async () => ({ decision: 'SKIP' })
  const speakUp = async () => ({ decision: 'COMMENT', comment: 'hi' })
  await run({ comment: skip, skipBehavior: 'silence', signOff: false })
  assert.deepEqual(played.splice(0), [])
  await run({ comment: skip, skipBehavior: 'line', signOff: false })
  assert.deepEqual(played.splice(0), ['skip.wav'])
  await run({ comment: speakUp, skipBehavior: 'silence', signOff: false })
  assert.deepEqual(played.splice(0), ['comment.wav'])
  await run({ comment: speakUp, skipBehavior: 'silence', signOff: true })
  assert.deepEqual(played.splice(0), ['comment.wav', 'signoff.wav'])
  assert.equal(config.skipBehavior, 'silence')
  assert.equal(config.signOff, false)
})

test('every pre-written line is short and passes the same filter', () => {
  for (const line of Object.values(CLIP_LINES).flat()) assert.ok(countWords(line) <= 25, line)
  // Stock lines reach kids in place of Gemini's, so they must clear the same filter.
  for (const line of [...CLIP_LINES.fallback, ...CLIP_LINES.error]) assert.equal(rejectReason(line), null, line)
  assert.deepEqual(Object.fromEntries(Object.entries(CLIP_LINES).map(([k, v]) => [k, v.length])), { cover: 5, 'cover-long': 5, fallback: 10, group: 3, press: 3, skip: 2, error: 1, signoff: 2 })
})

test('a good comment and a SKIP pass through', async () => {
  const ok = await generateComment(JPEG, { ...quiet, fetchImpl: modelSays({ decision: 'COMMENT', costume: 'witch', comment: 'Wonderful witch costume, what a treat!' }) })
  assert.deepEqual([ok.decision, ok.comment, ok.source], ['COMMENT', 'Wonderful witch costume, what a treat!', 'model'])
  const skip = await generateComment(JPEG, { ...quiet, fetchImpl: modelSays({ decision: 'SKIP', comment: 'nobody here' }) })
  assert.deepEqual([skip.decision, skip.comment], ['SKIP', ''])
})

const FAILURES = [
  ['timeout', (_u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))), 'timeout'],
  ['server error', reply({ error: { status: 'INTERNAL' } }, 500), 'http_500'],
  ['bad key', reply({ error: { status: 'PERMISSION_DENIED' } }, 403), 'http_403'],
  ['network', async () => { throw new Error('ECONNRESET') }, 'error'],
  ['safety block', reply({ promptFeedback: { blockReason: 'SAFETY' } }), 'blocked:SAFETY'],
  ['empty', reply({ candidates: [{ finishReason: 'SAFETY' }] }), 'no_output:SAFETY'],
  ['cut-off JSON', reply({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"decision":"COMM' }] } }] }), 'bad_json:MAX_TOKENS'],
  ['unkind', modelSays({ decision: 'COMMENT', comment: 'You look so very old tonight' }), 'forbidden:age'],
]
for (const [name, fetchImpl, reason] of FAILURES) {
  test(`${name} gives a stock line, logged with the reason`, async () => {
    const logged = []
    const result = await generateComment(JPEG, { cfg, fetchImpl, log: (m) => logged.push(m) })
    assert.equal(result.decision, 'COMMENT')
    assert.equal(result.source, 'stock')
    assert.equal(result.reason, reason)
    assert.ok(FALLBACK_LINES.includes(result.comment))
    assert.match(logged[0], new RegExp(reason.split(':')[0]))
  })
}

test('the timeout stops a hung call inside the limit', async () => {
  const hang = (_u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  const result = await generateComment(JPEG, { ...quiet, fetchImpl: hang })
  assert.equal(result.reason, 'timeout')
  assert.ok(result.ms < 500, `took ${result.ms} ms`)
  assert.equal(config.geminiTimeoutMs, 2500)
})

test('door snapshots are not sent until billing is confirmed', async () => {
  const neverCalled = async () => assert.fail('must not reach Gemini')
  const result = await generateComment(JPEG, { cfg: { ...cfg, geminiBillingConfirmed: false }, log: () => {}, fetchImpl: neverCalled })
  assert.equal(result.reason, 'billing_not_confirmed')
  const noImage = await generateComment(null, { ...quiet, fetchImpl: neverCalled })
  assert.equal(noImage.reason, 'no_image')
})

test('warm-up runs on start and then on an interval', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let calls = 0
  const stop = startGeminiWarmup({ cfg: { ...cfg, geminiWarmupMs: 300000 }, warmUp: async () => { calls++; return { ok: true } } })
  assert.equal(calls, 1)
  t.mock.timers.tick(300000)
  t.mock.timers.tick(300000)
  assert.equal(calls, 3)
  stop()
  assert.equal(config.geminiWarmupMs, 300000)
})

test('eval metrics: specificity, recall and words, with failures kept apart', () => {
  const m = computeEvalMetrics([
    { personVisible: false, decision: 'SKIP', source: 'model', ms: 100, comment: '' },
    { personVisible: false, decision: 'COMMENT', source: 'model', ms: 200, comment: 'a b' },
    { personVisible: true, decision: 'COMMENT', source: 'model', ms: 300, comment: 'a b c d' },
    { personVisible: true, decision: 'SKIP', source: 'model', ms: 400, comment: '' },
    { personVisible: true, decision: 'COMMENT', source: 'stock', reason: 'timeout', ms: 2500, comment: 'x' },
  ])
  assert.equal(m.skipSpecificity, 0.5)
  assert.equal(m.personRecall, 0.5)
  assert.equal(m.meanWords, 4)
  assert.equal(m.p95Ms, 385)
  assert.equal(m.stock, 1)
  assert.deepEqual(m.stockReasons, { timeout: 1 })
})

const tone = (seconds) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=800:duration=${seconds}`, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', '-af', 'volume=-30dB', '-f', 'wav', 'pipe:1'], { maxBuffer: 1e8 }).stdout
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tts-test-'))
const ttsCfg = { ...config, elevenLabsApiKey: 'test', elevenLabsVoiceId: 'voice', ttsHighpassHz: 200, ttsPresenceDb: 0, ttsLeadingSilenceMs: 300 }

function loudness(file) {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=I=-14:TP=-1:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
  return JSON.parse(out.slice(out.lastIndexOf('{'), out.lastIndexOf('}') + 1))
}

test('normalising hits -14 LUFS and -1 dBTP, with 300 ms of real leading silence', async () => {
  const dir = tempDir()
  const input = path.join(dir, 'in.wav')
  fs.writeFileSync(input, tone(3))
  const output = path.join(dir, 'out.wav')
  await normalizeClip(input, output, ttsCfg)
  const stats = loudness(output)
  assert.ok(Math.abs(Number(stats.input_i) + 14) < 1.5, `integrated ${stats.input_i}`)
  assert.ok(Number(stats.input_tp) <= -0.5, `true peak ${stats.input_tp}`)
  const pcm = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', output, '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1'], { maxBuffer: 1e8 }).stdout
  const samples = Array.from({ length: pcm.length / 2 }, (_, i) => Math.abs(pcm.readInt16LE(i * 2)))
  const firstLoud = samples.findIndex((s) => s > 300)
  assert.ok(Math.abs(firstLoud / 24 - 300) < 15, `sound starts at ${firstLoud / 24} ms`)
})

test('the doorbell master is louder, stays under the peak ceiling, and leaves the source alone', async () => {
  const dir = tempDir()
  const input = path.join(dir, 'in.wav')
  fs.writeFileSync(input, tone(3))
  const before = fs.readFileSync(input)
  const output = await masterForDoorbell(input)
  assert.deepEqual(fs.readFileSync(input), before)
  assert.notEqual(output, input)
  const report = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', output, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.split('Summary:').at(-1)
  assert.ok(Number(report.match(/Peak:\s+(-?[\d.]+)/)[1]) <= -0.5, report)
  assert.ok(Number(report.match(/I:\s+(-?[\d.]+)/)[1]) > -14, report)
  assert.equal(await masterForDoorbell(input), output, 'reuses the made copy')
})

test('the request uses the voice settings; file output is wav_24000 on the US host', async () => {
  const seen = []
  const dir = tempDir()
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return new Response(tone(1)) }
  const file = await synthesize('Hello there', { cfg: ttsCfg, fetchImpl, clipsDir: dir })
  assert.equal(path.extname(file), '.wav')
  assert.ok(fs.statSync(file).size > 10000)
  assert.equal(seen[0].url, `${config.elevenLabsBaseUrl}/v1/text-to-speech/voice?output_format=wav_24000`)
  assert.equal(config.elevenLabsBaseUrl, 'https://api.us.elevenlabs.io')
  const body = JSON.parse(seen[0].init.body)
  assert.equal(body.model_id, 'eleven_flash_v2_5')
  assert.deepEqual(body.voice_settings, { stability: 0.55, similarity_boost: 0.8, style: 0, use_speaker_boost: true, speed: 0.92 })
  assert.equal(body.use_pvc_as_ivc, undefined)
})

test('a repeated line comes from the cache; other settings make a new clip', async () => {
  let calls = 0
  const dir = tempDir()
  const fetchImpl = async () => { calls++; return new Response(tone(1)) }
  const a = await synthesize('Same line', { cfg: ttsCfg, fetchImpl, clipsDir: dir })
  const b = await synthesize('Same line', { cfg: ttsCfg, fetchImpl, clipsDir: dir })
  assert.equal(a, b)
  assert.equal(calls, 1)
  await synthesize('Same line', { cfg: { ...ttsCfg, ttsSpeed: 1 }, fetchImpl, clipsDir: dir })
  assert.equal(calls, 2)
  assert.notEqual(clipKey('Same line', ttsCfg), clipKey('Same line', { ...ttsCfg, ttsUsePvcAsIvc: true }))
  assert.equal(voiceRequest('x', { ...ttsCfg, ttsUsePvcAsIvc: true }).use_pvc_as_ivc, true)
})

test('an API failure throws without leaving a broken clip in the cache', async () => {
  const dir = tempDir()
  await assert.rejects(
    synthesize('Oops', { cfg: ttsCfg, clipsDir: dir, fetchImpl: async () => new Response('nope', { status: 401 }) }),
    /HTTP 401/,
  )
  assert.equal(fs.existsSync(path.join(dir, 'cache', `${clipKey('Oops', ttsCfg)}.wav`)), false)
})

test('the stream header makes raw PCM readable by ffmpeg, with no known length', () => {
  const pcm = Buffer.alloc(48000)
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'csv=p=0', 'pipe:0'], { input: Buffer.concat([wavHeader(), pcm]), encoding: 'utf8' })
  assert.equal(result.stdout.trim(), 'pcm_s16le,24000,1')
})
