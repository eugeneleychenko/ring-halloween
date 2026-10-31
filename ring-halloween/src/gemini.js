import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Agent, fetch as undiciFetch } from 'undici'
import { config, measurementPath, ROOT } from './config.js'
import { appendCsvRow } from './csv.js'
import { CLIP_LINES } from './clip-lines.js'

export const MAX_WORDS = 25
export const MIN_WORDS = 5
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const LOG_COLUMNS = ['at', 'model', 'ms', 'decision', 'source', 'reason', 'comment']

export const SYSTEM_INSTRUCTION = `You are ${config.characterName}, a theatrical, deep-voiced door demon who is secretly a softie and loves Halloween costumes.
You will see one photo from a doorbell camera.

Decide using one test only: can you see at least one human being anywhere in the photo, in any clothes or costume, even in a crowd or partly hidden by a mask? People count even if they are not at the door and even if they wear no costume. If yes, decision is COMMENT. If there is no human at all (empty porch, shadows, car, pet, decoration, statue, blur, insect, rain), decision is SKIP with an empty costume and comment.

For COMMENT, write ONE line, 12 to ${MAX_WORDS} words, spoken aloud to the visitor or visitors.

The line must:
- Compliment the COSTUME, prop, character, or effort. If you cannot tell what the costume is, compliment the overall spooky look or Halloween spirit.
- Be kind, playful, and safe for a three-year-old. Scary-sounding words are fine ("Who dares approach"), threats are not.
- Open big, land warm. Plain punctuation only. No digits. At most one exclamation mark.
- Sound fresh each time. Rotate your openers, such as Ooooh, Well well, By my horns, Great pumpkins, Aha, RAAAWR, and do not lean on Behold or magnificent.
- If more than one person, address the group.
- If the image is black and white (infrared), do not mention colours.

Never: mention body, size, weight, height, age, gender, hair, skin, face, glasses, or how attractive anyone is. Do not use words like little, tiny, cute, pretty, kid, boy or girl. Never guess who someone is or say a name. Never say you are watching or recording, or that you see someone. Never tell the visitor to come closer or come inside. Never mention eating anyone, blood, death, or being alone in the dark. Never judge whether a costume is homemade or store-bought.

Examples:
- Costume: dinosaur onesie. "RAAAWR! A dinosaur at my door! Millions of years late for the party, but right on time for candy. Happy Halloween!"
- Three visitors: a witch, a firefighter, and something unclear. "A witch, a firefighter, and a mystery! What a crew. Wonderful costumes, all of you. Come get your treats!"
- Someone in a hoodie, no costume. "Ah, the classic too cool for costumes look. Respect. Happy Halloween, and grab some candy anyway!"
- Someone carrying a pumpkin costume wearer. "A pumpkin! The finest pumpkin on the whole street. Happy Halloween, mighty pumpkin!"
- Dark porch, nobody there. decision SKIP, costume empty, comment empty.`

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    decision: { type: 'STRING', enum: ['COMMENT', 'SKIP'] },
    costume: { type: 'STRING' },
    comment: { type: 'STRING' },
  },
  required: ['decision', 'costume', 'comment'],
  propertyOrdering: ['decision', 'costume', 'comment'],
}

export const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_LOW_AND_ABOVE' },
]

const APPEARANCE = 'pretty|cute|handsome|beautiful|gorgeous|tall|short|small|big|skinny|thin|old|young'
const STANDALONE_MAN = /(?<![-\w])(?<!iron )(?<!spider )(?<!ant )(?<!bat )(?<!super )man\b/i

export function loadDenylist(file = path.join(ROOT, 'config', 'denylist.txt')) {
  const rules = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue
    const [topic, terms] = line.split('|').map((part) => part.trim())
    const alternatives = terms.split(',').map((term) => term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    rules.push([topic, new RegExp(`\\b(${alternatives.join('|')})\\b`, 'i')])
  }
  return rules
}
const DENYLIST = loadDenylist()

export function rejectReason(comment, { lastComment = null } = {}) {
  const text = String(comment ?? '').trim().replaceAll('’', "'")
  if (!text) return 'empty'
  const words = countWords(text)
  if (words > MAX_WORDS) return 'too_long'
  if (words < MIN_WORDS) return 'too_short'
  if (/\d/.test(text)) return 'digit'
  if (lastComment && text.toLowerCase() === lastComment.trim().toLowerCase()) return 'repeat'
  if (new RegExp(`\\byou('re| are) so (${APPEARANCE})\\b`, 'i').test(text)) return 'forbidden:looks'
  if (STANDALONE_MAN.test(text)) return 'forbidden:gender'
  for (const [topic, pattern] of DENYLIST) {
    if (pattern.test(text)) return `forbidden:${topic}`
  }
  return null
}

export const countWords = (text) => String(text).trim().split(/\s+/).filter(Boolean).length

// Random, but never the same stock line twice in a row.
let lastStock = null
export function stockLine(random = Math.random) {
  const lines = CLIP_LINES.fallback.filter((line) => line !== lastStock)
  lastStock = lines[Math.floor(random() * lines.length)]
  return lastStock
}

export function downscaleJpeg(jpegBuffer, { maxPx = config.geminiImageMaxPx, ffmpegPath = config.ffmpegPath } = {}) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-frames:v', '1',
      '-vf', `scale=w='min(${maxPx},iw)':h='min(${maxPx},ih)':force_original_aspect_ratio=decrease`,
      '-q:v', '6', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    let stderr = ''
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk))
    ffmpeg.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-500) })
    ffmpeg.stdin.on('error', () => {})
    ffmpeg.on('error', reject)
    ffmpeg.on('close', (code) => {
      if (code === 0 && chunks.length) resolve(Buffer.concat(chunks))
      else reject(new Error(`Could not read the image: ${stderr.trim() || `ffmpeg code ${code}`}`))
    })
    ffmpeg.stdin.end(jpegBuffer)
  })
}

export function buildRequest(jpegForModel, cfg = config, { previousComment = null } = {}) {
  const avoid = previousComment
    ? ` Your previous line was: "${previousComment}". Use a different opening word and a different main adjective this time.`
    : ''
  return {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{
      role: 'user',
      parts: [
        { text: `This is the view from the doorbell right now.${avoid}` },
        { inlineData: { mimeType: 'image/jpeg', data: jpegForModel.toString('base64') } },
      ],
    }],
    generationConfig: {
      temperature: cfg.geminiTemperature,
      maxOutputTokens: cfg.geminiMaxOutputTokens,
      mediaResolution: `MEDIA_RESOLUTION_${cfg.geminiMediaResolution.toUpperCase()}`,
      thinkingConfig: { thinkingLevel: cfg.geminiThinkingLevel },
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
    safetySettings: SAFETY_SETTINGS,
  }
}

// One long-lived connection pool: a warm connection skips the TLS handshake.
const dispatcher = new Agent({ keepAliveTimeout: 330_000, keepAliveMaxTimeout: 600_000 })
const speech = { lastComment: null }
const defaultFetch = (url, init) => undiciFetch(url, { ...init, dispatcher })

async function callGemini(body, { cfg, fetchImpl, signal }) {
  const response = await fetchImpl(`${API_BASE}/${cfg.geminiModel}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': cfg.geminiApiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const json = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(`Gemini HTTP ${response.status}: ${json?.error?.status ?? 'error'}`)
    error.reason = `http_${response.status}`
    throw error
  }
  return json
}

function interpret(json, state) {
  if (json?.promptFeedback?.blockReason) return { failure: `blocked:${json.promptFeedback.blockReason}` }
  const candidate = json?.candidates?.[0]
  const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('')
  if (!text) return { failure: `no_output:${candidate?.finishReason ?? 'unknown'}` }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { failure: `bad_json:${candidate?.finishReason ?? 'unknown'}` }
  }
  if (parsed.decision === 'SKIP') return { decision: 'SKIP', comment: '' }
  if (parsed.decision !== 'COMMENT') return { failure: 'bad_decision' }
  const rejected = rejectReason(parsed.comment, state)
  if (rejected) return { failure: rejected, rejectedComment: parsed.comment }
  return { decision: 'COMMENT', comment: parsed.comment.trim(), costume: parsed.costume ?? '' }
}

function logResult(result, cfg) {
  appendCsvRow(measurementPath('gemini.csv'), LOG_COLUMNS, {
    at: new Date().toISOString(),
    model: cfg.geminiModel,
    ms: result.ms,
    decision: result.decision,
    source: result.source,
    reason: result.reason ?? '',
    // A rejected line is kept so that the filter can be reviewed. It is never spoken.
    comment: result.rejectedComment ?? result.comment,
  })
}

/**
 * Never throws and always returns within the timeout. Any failure gives a stock
 * compliment, because saying something kind beats silence at the door.
 * `source` is 'model' or 'stock'; `reason` says why a stock line was used.
 */
export async function generateComment(jpegBuffer, {
  cfg = config,
  fetchImpl = defaultFetch,
  publicImage = false,
  random = Math.random,
  log = console.warn,
} = {}) {
  const started = Date.now()
  const stock = (reason, extra = {}) => ({ decision: 'COMMENT', comment: stockLine(random), source: 'stock', reason, ...extra })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.geminiTimeoutMs)
  let result
  try {
    if (!jpegBuffer) result = stock('no_image')
    else if (!cfg.geminiApiKey) result = stock('no_api_key')
    // On the free tier Google staff may read inputs: no door snapshots until billing is on.
    else if (!cfg.geminiBillingConfirmed && !publicImage) result = stock('billing_not_confirmed')
    else {
      const body = buildRequest(await downscaleJpeg(jpegBuffer, { maxPx: cfg.geminiImageMaxPx, ffmpegPath: cfg.ffmpegPath }), cfg, { previousComment: speech.lastComment })
      const outcome = interpret(await callGemini(body, { cfg, fetchImpl, signal: controller.signal }), speech)
      result = outcome.failure
        ? stock(outcome.failure, { rejectedComment: outcome.rejectedComment })
        : { ...outcome, source: 'model' }
      if (result.source === 'model' && result.decision === 'COMMENT') speech.lastComment = result.comment
    }
  } catch (error) {
    result = stock(controller.signal.aborted ? 'timeout' : (error.reason ?? 'error'))
  } finally {
    clearTimeout(timer)
  }
  result.ms = Date.now() - started
  if (result.source === 'stock') log(`[gemini] stock line used: ${result.reason}`)
  logResult(result, cfg)
  return result
}

export async function warmUpGemini({ cfg = config, fetchImpl = defaultFetch } = {}) {
  if (!cfg.geminiApiKey) return { ok: false, ms: 0 }
  const started = Date.now()
  try {
    await callGemini({
      contents: [{ role: 'user', parts: [{ text: 'ok' }] }],
      generationConfig: { maxOutputTokens: 1, thinkingConfig: { thinkingLevel: cfg.geminiThinkingLevel } },
    }, { cfg, fetchImpl, signal: AbortSignal.timeout(cfg.geminiTimeoutMs * 2) })
    return { ok: true, ms: Date.now() - started }
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error.message }
  }
}

export function startGeminiWarmup({ cfg = config, warmUp = () => warmUpGemini({ cfg }), log = console.warn } = {}) {
  const run = async () => {
    const result = await warmUp()
    if (!result.ok) log(`[gemini] warm-up failed: ${result.error ?? 'no key'}`)
  }
  run()
  const timer = setInterval(run, cfg.geminiWarmupMs)
  timer.unref()
  return () => clearInterval(timer)
}
