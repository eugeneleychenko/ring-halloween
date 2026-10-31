import readline from 'node:readline'
import { parseArgs } from 'node:util'
import { measurementPath } from '../config.js'
import { appendCsvRow } from '../csv.js'
import { EVENT_COLUMNS, eventRow, watchEvents } from '../events.js'
import { onTrigger } from '../pipeline.js'
import { stubComment, stubSnapshot, stubSynthesize } from '../stubs.js'
import { connectRing, describeCamera, pickDoorbell, printCamera } from '../ring.js'
import { getFreshSnapshot, recordSnapshot } from '../snapshot.js'

const TRIAL_TIMEOUT_MS = 30000
const TRIAL_COLUMNS = ['marked_at', 'marked_ms', 'result', 'ding_id', 'event_type', 'mark_to_event_ms']

const { values: args } = parseArgs({
  args: process.env.LISTEN_ARGS?.split(' ') ?? process.argv.slice(2),
  options: {
    snapshot: { type: 'boolean', default: false },
    respond: { type: 'boolean', default: false },
    // Real events through the real gate, with a pretend 5 s clip: no sound, no paid APIs.
    'cooldown-test': { type: 'boolean', default: false },
    routes: { type: 'string', default: 'uuid,keyframe,forced' },
  },
})

const ring = await connectRing()
const camera = pickDoorbell(ring.cameras)
printCamera(describeCamera(camera))
const eventsCsv = measurementPath('events.csv')
const trialsCsv = measurementPath('event-trials.csv')

const openTrials = []
function markTrial() {
  const trial = { markedAt: Date.now() }
  trial.timer = setTimeout(() => {
    openTrials.splice(openTrials.indexOf(trial), 1)
    appendCsvRow(trialsCsv, TRIAL_COLUMNS, { marked_at: new Date(trial.markedAt).toISOString(), marked_ms: trial.markedAt, result: 'miss' })
    console.log(`[trial] MISS: no event within ${TRIAL_TIMEOUT_MS / 1000} s of the mark`)
  }, TRIAL_TIMEOUT_MS)
  openTrials.push(trial)
  console.log('[trial] marked. Waiting for the event...')
}
function resolveTrial(event) {
  const trial = openTrials.shift()
  if (!trial) return
  clearTimeout(trial.timer)
  const delay = event.receivedAt - trial.markedAt
  appendCsvRow(trialsCsv, TRIAL_COLUMNS, {
    marked_at: new Date(trial.markedAt).toISOString(), marked_ms: trial.markedAt, result: 'hit',
    ding_id: event.id, event_type: event.type, mark_to_event_ms: delay,
  })
  console.log(`[trial] HIT: ${delay} ms from your mark to the event`)
}

const stop = watchEvents(camera, {
  async onEvent(event) {
    const row = eventRow(event)
    appendCsvRow(eventsCsv, EVENT_COLUMNS, row)
    console.log(`[event] ${event.type} ${event.id} (${event.detectionType ?? event.subtype ?? 'n/a'}): arrived ${row.delay_ms === '' ? '?' : row.delay_ms} ms after triggered_at, snapshot UUID ${event.snapshotUuid ? 'yes' : 'no'}`)
    if (event.e2eeEnabled) console.log('[event] WARNING: End-to-End Encryption is on. Talk and live view will not work until it is off.')
    resolveTrial(event)
    if (args['cooldown-test']) {
      const result = await onTrigger(event, {
        camera, output: 'bluetooth', snapshot: stubSnapshot, storeSnapshot: null, comment: stubComment, speak: stubSynthesize,
        openSession: () => null, play: async () => { await new Promise((r) => setTimeout(r, 5000)); return { firstAudioAt: Date.now() } },
      })
      console.log(`[cooldown-test] ${event.id}: ${result.status}${result.row?.error ? ` (${result.row.error})` : ''}`)
    } else if (args.respond) {
      const result = await onTrigger(event, { camera })
      console.log(`[pipeline] ${result.status}`)
    } else if (args.snapshot) {
      try {
        const image = await getFreshSnapshot(event, { camera, routes: args.routes.split(',') })
        const file = recordSnapshot(event, image)
        console.log(`[snapshot] ${image.source}: ${image.fetchMs} ms, taken ${image.takenAt - event.eventAt} ms after the event, ${file}`)
      } catch (error) {
        recordSnapshot(event, error)
        console.log(`[snapshot] FAILED: ${error.message}`)
      }
    }
  },
  onDuplicate(event, info) {
    appendCsvRow(eventsCsv, EVENT_COLUMNS, eventRow(event, { isDuplicate: true, ...info }))
    console.log(`[event] second push for ${event.id}, ${info.receivedAt - event.receivedAt} ms later, snapshot UUID ${info.snapshotUuid ? 'yes' : 'no'}`)
  },
})

console.log(`\nListening. Log: ${eventsCsv}`)
console.log('To measure the miss rate: press Enter at the moment you walk up or press the button. Ctrl-C to stop.\n')
if (process.stdin.isTTY) readline.createInterface({ input: process.stdin }).on('line', markTrial)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stop()
    ring.close()
    process.exit(130)
  })
}
