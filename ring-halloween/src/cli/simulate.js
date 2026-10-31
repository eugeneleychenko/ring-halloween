import { config, measurementPath } from '../config.js'
import { createTriggerGate, onTrigger } from '../pipeline.js'
import { fakeEvent, stubPlayAudio, stubSnapshot } from '../stubs.js'
import { printStatus } from '../status.js'

printStatus()
console.log(`Firing one pretend visitor through the chain (no Ring, no internet, no sound)...`)
const event = fakeEvent()
const result = await onTrigger(event, {
  output: config.output,
  gate: createTriggerGate({ cooldownMs: 0 }),
  snapshot: stubSnapshot,
  storeSnapshot: null,
  play: stubPlayAudio,
  openSession: () => null,
})
console.log(`Result: ${result.status}${result.comment ? `, comment: "${result.comment}"` : ''}`)
console.log(`Row added to ${measurementPath('runs.csv')}`)
process.exit(result.status === 'played' ? 0 : 1)
