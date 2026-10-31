import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { config, measurementPath } from '../config.js'
import { appendCsvRow, readCsv } from '../csv.js'
import { generateComment, warmUpGemini } from '../gemini.js'
import { computeEvalMetrics, formatEvalMetrics } from '../gemini-eval.js'

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repeat: { type: 'string', default: '1' },
    // A folder of public test images, not door snapshots, can run before billing is confirmed.
    public: { type: 'boolean', default: false },
    model: { type: 'string' },
    resolution: { type: 'string' },
  },
})
const folder = positionals[0]
if (!folder) throw new Error('Usage: npm run eval-gemini <folder> [-- --repeat 3 --public]')
const labels = readCsv(path.join(folder, 'label.csv'))
if (!labels.length) throw new Error(`No rows in ${path.join(folder, 'label.csv')} (needs columns: file, person_visible)`)
if (!config.geminiBillingConfirmed && !args.public) {
  throw new Error('Billing is not confirmed, so door snapshots are not sent. For public test images add: -- --public')
}
const cfg = {
  ...config,
  geminiModel: args.model ?? config.geminiModel,
  geminiMediaResolution: args.resolution ?? config.geminiMediaResolution,
}
const COLUMNS = ['at', 'folder', 'model', 'media_resolution', 'file', 'person_visible', 'decision', 'source', 'reason', 'ms', 'words', 'comment', 'rejected_comment']
const warm = await warmUpGemini({ cfg })
console.log(`Warm-up: ${warm.ok ? `ok in ${warm.ms} ms` : `FAILED ${warm.error}`}`)

const results = []
for (let round = 0; round < Number(args.repeat); round++) {
  for (const { file, person_visible: label } of labels) {
    const result = await generateComment(fs.readFileSync(path.join(folder, file)), { cfg, publicImage: true, log: () => {} })
    const personVisible = /^(true|yes|1|y)$/i.test(label.trim())
    results.push({ file, personVisible, ...result })
    appendCsvRow(measurementPath('gemini-eval.csv'), COLUMNS, {
      at: new Date().toISOString(), folder: path.basename(folder), model: cfg.geminiModel, media_resolution: cfg.geminiMediaResolution,
      file, person_visible: personVisible, decision: result.decision, source: result.source, reason: result.reason ?? '',
      ms: result.ms, words: result.comment ? result.comment.trim().split(/\s+/).length : 0, comment: result.comment, rejected_comment: result.rejectedComment ?? '',
    })
    const marker = result.source !== 'model' ? `STOCK(${result.reason})` : result.decision === (personVisible ? 'COMMENT' : 'SKIP') ? 'ok' : 'WRONG'
    console.log(`  ${marker.padEnd(10)} ${String(result.ms).padStart(5)} ms  ${personVisible ? 'person' : 'empty '}  ${file}: ${result.decision} ${result.rejectedComment ? `[rejected: ${result.rejectedComment}]` : result.comment}`)
  }
}
console.log(`\n${cfg.geminiModel}, media_resolution ${cfg.geminiMediaResolution}\n${formatEvalMetrics(computeEvalMetrics(results))}`)
console.log(`Details: ${measurementPath('gemini-eval.csv')}`)
process.exit(0)
