import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { config, measurementPath } from '../config.js'
import { appendCsvRow } from '../csv.js'
import { percentile } from '../probe-summary.js'
import { synthesize, synthesizeStream } from '../tts.js'

const LINES = [
  'That is a magnificent witch costume, and that pointed hat is perfect for a spooky night like this one.',
  'What a superb skeleton costume, those bones glow wonderfully, and you are ready to haunt the whole street.',
  'Spider-Man has come to my door, what a great suit, those webs look ready for a night of adventure.',
  'A dinosaur on my porch! That costume is terrific, with claws and a tail worthy of a prehistoric party.',
  'Now that is a fine vampire cape, swooping and dramatic, the perfect costume for collecting treats tonight.',
  'What a brilliant pirate costume, that hat and sword are ready to sail away with all of the treasure.',
  'A royal crown and a sparkling gown, what a wonderful princess costume, your castle would be very proud.',
  'That ghost costume is hauntingly good, floating and mysterious, exactly what a Halloween night should have.',
  'Great zombie costume! Those tattered clothes are perfectly creepy, and I bet the candy will come running.',
  'What a clever pumpkin costume, round and glowing, you are the finest jack-o-lantern I have seen all night.',
  'That superhero cape looks ready to save Halloween, what a bold and heroic costume for this spooky evening.',
  'A ninja at my door! That stealthy costume is excellent, I almost did not see you sneak right up.',
  'What a fantastic astronaut suit, that helmet is out of this world, and your mission for candy will succeed.',
  'That fairy costume is magical, with shimmering wings and a sparkling wand, ready to cast some wonderful spells.',
  'Now that is a mighty knight, what a splendid suit of armor, the dragons must be trembling tonight.',
  'A friendly monster with terrific fangs, what a great costume, you are welcome on my porch any time.',
  'What an incredible robot costume, those lights and dials are amazing, it must run entirely on candy.',
  'That mummy costume is wrapped to perfection, what an ancient and spooky look for a night of treats.',
  'A wizard with a fine tall hat and staff, what a powerful costume, your magic is working on me.',
  'What a wonderful scarecrow costume, stitched and straw filled, even the crows are impressed with you tonight.',
]
const COLUMNS = ['label', 'n', 'p50_ms', 'p95_ms', 'max_ms', 'api_p50_ms', 'api_p95_ms', 'failures']
const { values: args } = parseArgs({ options: { pvc: { type: 'boolean', default: false }, stream: { type: 'boolean', default: false } } })

async function measure(label, overrides) {
  const cfg = { ...config, ...overrides }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-measure-'))
  const totals = []
  const apis = []
  let failures = 0
  for (const [i, line] of LINES.entries()) {
    const started = Date.now()
    try {
      const timedFetch = async (...a) => {
        const response = await fetch(...a)
        const body = await response.arrayBuffer()
        apis.push(Date.now() - started)
        return new Response(body, { status: response.status })
      }
      await synthesize(line, { cfg, outputPath: path.join(dir, `${i}.wav`), useCache: false, fetchImpl: timedFetch })
      totals.push(Date.now() - started)
    } catch (error) {
      failures++
      console.log(`  ${label} line ${i + 1} failed: ${error.message}`)
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
  const row = {
    label, n: totals.length,
    p50_ms: percentile(totals, 0.5), p95_ms: percentile(totals, 0.95), max_ms: percentile(totals, 1),
    api_p50_ms: percentile(apis, 0.5), api_p95_ms: percentile(apis, 0.95), failures,
  }
  appendCsvRow(measurementPath('tts-summary.csv'), COLUMNS, row)
  console.log(`${label}: total p50 ${row.p50_ms} ms, p95 ${row.p95_ms} ms, max ${row.max_ms} ms; API alone p50 ${row.api_p50_ms} ms, p95 ${row.api_p95_ms} ms; failures ${failures} (target 1500 ms)`)
}

// Each mode runs before and after the other, so that warm-up can't favour either.
await measure('default', { ttsUsePvcAsIvc: false })
if (args.pvc) {
  await measure('use_pvc_as_ivc', { ttsUsePvcAsIvc: true })
  await measure('use_pvc_as_ivc', { ttsUsePvcAsIvc: true })
  await measure('default', { ttsUsePvcAsIvc: false })
}
if (args.stream) {
  const firsts = []
  for (const line of LINES.slice(0, 5)) {
    const { stream, info } = await synthesizeStream(line)
    for await (const _chunk of stream) { /* drain */ }
    firsts.push(info.firstByteMs)
  }
  console.log(`stream first byte: ${firsts.join(', ')} ms`)
}
