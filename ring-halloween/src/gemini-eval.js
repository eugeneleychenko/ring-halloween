import { percentile } from './probe-summary.js'

const rate = (hit, total) => (total ? hit / total : null)
const pct = (value) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`)

// Stock lines are not model decisions, so failures are counted apart rather than
// being scored as if the model had chosen COMMENT.
export function computeEvalMetrics(results) {
  const model = results.filter((r) => r.source === 'model')
  const empties = model.filter((r) => !r.personVisible)
  const people = model.filter((r) => r.personVisible)
  const correctSkips = empties.filter((r) => r.decision === 'SKIP').length
  const found = people.filter((r) => r.decision === 'COMMENT')
  const words = found.map((r) => r.comment.trim().split(/\s+/).length)
  const stockReasons = {}
  for (const r of results.filter((x) => x.source !== 'model')) stockReasons[r.reason] = (stockReasons[r.reason] ?? 0) + 1
  const ms = model.map((r) => r.ms)
  const firstWords = found.map((r) => r.comment.trim().split(/[\s,!.…]+/)[0].toLowerCase())
  const openerCounts = {}
  for (const word of firstWords) openerCounts[word] = (openerCounts[word] ?? 0) + 1
  const topOpener = Object.entries(openerCounts).sort((a, b) => b[1] - a[1])[0]
  const usingWord = (word) => found.filter((r) => r.comment.toLowerCase().includes(word)).length
  return {
    calls: results.length,
    skipSpecificity: rate(correctSkips, empties.length),
    emptyFrames: empties.length,
    personRecall: rate(found.length, people.length),
    personFrames: people.length,
    meanWords: words.length ? words.reduce((a, b) => a + b, 0) / words.length : null,
    maxWords: words.length ? Math.max(...words) : null,
    topOpener: topOpener ? `${topOpener[0]} ${topOpener[1]}/${found.length}` : 'n/a',
    distinctOpeners: Object.keys(openerCounts).length,
    magnificent: `${usingWord('magnificent')}/${found.length}`,
    p50Ms: percentile(ms, 0.5),
    p95Ms: percentile(ms, 0.95),
    maxMs: percentile(ms, 1),
    stock: results.length - model.length,
    stockReasons,
  }
}

export function formatEvalMetrics(m) {
  return [
    `SKIP specificity: ${pct(m.skipSpecificity)} of ${m.emptyFrames} empty frames (target at least 95%)`,
    `Person recall:    ${pct(m.personRecall)} of ${m.personFrames} person frames`,
    `Mean word count:  ${m.meanWords?.toFixed(1) ?? 'n/a'} (longest ${m.maxWords ?? 'n/a'}, limit 25)`,
    `Variety:          most used opener ${m.topOpener}, ${m.distinctOpeners} different openers, "magnificent" in ${m.magnificent}`,
    `Latency:          p50 ${m.p50Ms ?? 'n/a'} ms, p95 ${m.p95Ms ?? 'n/a'} ms, max ${m.maxMs ?? 'n/a'} ms (target at most 2000 ms)`,
    `Stock fallbacks:  ${m.stock} of ${m.calls} calls ${JSON.stringify(m.stockReasons)}`,
  ].join('\n')
}
