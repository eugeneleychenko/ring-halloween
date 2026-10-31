import { measurementPath } from './config.js'
import { appendCsvRow } from './csv.js'
import { percentile } from './probe-summary.js'

export const UAT_COLUMNS = [
  'checkpoint', 'scenario', 'trigger_id', 'event_received_at', 'first_audio_at', 'comment_at',
  'output', 'gemini_decision', 'comment_text', 'pass', 'eugene_note',
]

// `expect` drives the automatic suggestion. The final pass or fail is always Eugene's.
const CP2_SCENARIOS = [
  { id: 1, text: 'Walk up in a clear costume, or holding an obvious prop such as a witch hat', expected: 'Cover clip in about 1 s, then a kind comment naming the costume, within 10 s of motion', expect: 'one_comment' },
  { id: 2, text: 'Walk up in plain clothes', expected: 'Cover clip, then a kind comment that never mentions body, age, size or who you are', expect: 'one_comment' },
  { id: 3, text: 'Two people walk up together', expected: 'One cover clip and one comment, never two comments', expect: 'one_comment' },
  { id: 4, text: 'No person: roll a ball, wave a broom, or let a car pass', expected: 'Cover clip at most, no comment', expect: 'no_comment' },
  { id: 5, text: 'Repeat scenario 1 at night with the porch light on', expected: 'Same as scenario 1. Note whether the picture was colour or infrared', expect: 'one_comment', logOnly: true },
  { id: 6, text: 'Repeat scenario 1 at night with the porch light off', expected: 'Note whether the costume was still recognised', expect: 'any', logOnly: true },
  { id: 7, text: 'Stand still in view for 30 s', expected: 'One comment only, with no repeats while you stand there', expect: 'one_comment' },
  { id: 8, text: 'Unplug the Bluetooth speaker, then walk up', expected: 'Plays on the Mac speaker with a warning logged. Reconnects within 30 s once plugged back in', expect: 'one_comment' },
]

export const CHECKPOINTS = {
  1: {
    title: 'Does it hear me?',
    mode: { output: 'bluetooth', stockClipOnly: true },
    scenarios: [
      { id: 1, text: 'Walk up to the door normally, stop, and wait 10 s', expected: 'Stock clip plays on the Bluetooth speaker within 6 s', expect: 'plays' },
      { id: 2, text: 'Press the doorbell', expected: 'Stock clip plays within 6 s. Not required, since nobody is home on the night', expect: 'any', logOnly: true },
      { id: 3, text: 'Walk up again, 20 s after your last walk-up began', expected: 'Plays again: duplicates must not swallow it', expect: 'plays' },
      { id: 4, text: 'Walk up again, within 10 s of the clip ending', expected: 'Nothing plays. The event is logged as suppressed', expect: 'suppressed' },
      { id: 5, text: 'Walk past at the edge of the view without approaching', expected: 'Either result is fine. This logs what the Ring motion zone does', expect: 'any', logOnly: true },
    ],
  },
  2: { title: 'Does it see me?', mode: { output: 'bluetooth', stockClipOnly: false }, scenarios: CP2_SCENARIOS },
  3: {
    title: 'Would I run this on Halloween?',
    mode: { output: 'both', stockClipOnly: false },
    scenarios: [
      ...CP2_SCENARIOS.filter((s) => [1, 3, 4, 5].includes(s.id)),
      { id: 9, text: 'Walk up and listen for which speaker talks', expected: 'Exactly one output plays the comment. The decision and reason are in the log', expect: 'one_comment' },
      { id: 10, text: 'Walk up while your phone has Ring live view open', expected: 'Report what happens', expect: 'any', logOnly: true },
      { id: 11, text: 'Leave it running for 3 hours, then walk up', expected: 'Still reacts, with no re-sign-in and no speaker drop', expect: 'one_comment', logOnly: true },
    ],
    closing: 'Would you run this on Halloween night? Answer yes or no, with one sentence why',
  },
}

export function suggestResult(scenario, runs) {
  const played = runs.filter((r) => r.status === 'played').length
  const suppressed = runs.filter((r) => r.status === 'suppressed').length
  switch (scenario.expect) {
    case 'plays': return played >= 1
    case 'suppressed': return played === 0 && suppressed >= 1
    case 'one_comment': return played === 1
    case 'no_comment': return played === 0
    default: return null
  }
}

/**
 * Runs one checkpoint. Everything that touches the door is passed in:
 * collectTriggers(scenario) resolves with the onTrigger results seen during a scenario,
 * and ask(question) reads Eugene's answer. A scenario with no trigger still gets a row.
 */
export async function runCheckpoint(checkpoint, { collectTriggers, ask, output, log = console.log, file = measurementPath(`uat-${checkpoint}.csv`) }) {
  const definition = CHECKPOINTS[checkpoint]
  if (!definition) throw new Error(`--checkpoint must be 1, 2 or 3, got "${checkpoint}"`)
  const resolvedOutput = output ?? definition.mode.output
  log(`\nCheckpoint ${checkpoint}: ${definition.title} (output: ${resolvedOutput})\n`)
  const results = []
  for (const scenario of definition.scenarios) {
    log(`\nScenario ${scenario.id}: ${scenario.text}`)
    log(`  Expected: ${scenario.expected}`)
    await ask('  Press Return when you are ready to start. ')
    const runs = await collectTriggers(scenario)
    for (const run of runs) log(`  Saw ${run.row?.trigger_id ?? 'a trigger'}: ${run.status}${run.comment ? `, "${run.comment}"` : ''}`)
    const suggested = suggestResult(scenario, runs)
    const prompt = scenario.logOnly
      ? '  Logged. Did it go okay? (y/n) '
      : `  Did it behave as expected? ${suggested === null ? '' : `The log suggests ${suggested ? 'yes' : 'NO'}. `}(y/n) `
    const pass = (await ask(prompt)).trim().toLowerCase().startsWith('y')
    const note = (await ask('  Any note? (Return to skip) ')).trim()
    const base = { checkpoint, scenario: scenario.id, output: resolvedOutput, pass, eugene_note: note }
    if (!runs.length) appendCsvRow(file, UAT_COLUMNS, base)
    for (const run of runs) {
      appendCsvRow(file, UAT_COLUMNS, {
        ...base,
        trigger_id: run.row?.trigger_id,
        event_received_at: run.row?.event_received_at,
        first_audio_at: run.row?.first_audio_at,
        comment_at: run.row?.first_audio_at,
        gemini_decision: run.row?.gemini_decision,
        comment_text: run.comment ?? '',
      })
    }
    results.push({ scenario, runs, pass, note, suggested })
  }
  let closing = null
  if (definition.closing) {
    closing = (await ask(`\n${definition.closing}: `)).trim()
    appendCsvRow(file, UAT_COLUMNS, { checkpoint, scenario: 'verdict', output: resolvedOutput, eugene_note: closing })
  }
  const scorecard = buildScorecard(checkpoint, results, closing)
  log(`\n${scorecard}\n\nLog: ${file}`)
  return { results, scorecard }
}

export function buildScorecard(checkpoint, results, closing = null) {
  const lines = [`=== Checkpoint ${checkpoint} scorecard ===`]
  for (const { scenario, runs, pass, note } of results) {
    const counts = `${runs.filter((r) => r.status === 'played').length} played, ${runs.filter((r) => r.status === 'suppressed').length} suppressed`
    lines.push(`  ${scenario.logOnly ? 'LOG ' : pass ? 'PASS' : 'FAIL'}  ${String(scenario.id).padStart(2)}  ${counts}${note ? `  (${note})` : ''}`)
  }
  const graded = results.filter((r) => !r.scenario.logOnly)
  lines.push(`  ${graded.filter((r) => r.pass).length}/${graded.length} graded scenarios passed`)
  const delays = results.flatMap((r) => r.runs)
    .map((run) => (run.row?.first_audio_at && run.row?.event_received_at ? Date.parse(run.row.first_audio_at) - Date.parse(run.row.event_received_at) : NaN))
  const median = percentile(delays, 0.5)
  if (median !== null) lines.push(`  Event to first audio: median ${median} ms, max ${percentile(delays, 1)} ms`)
  if (closing) lines.push(`  Run on Halloween night? ${closing}`)
  return lines.join('\n')
}
