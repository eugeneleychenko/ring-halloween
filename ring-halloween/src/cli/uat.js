import { parseArgs } from 'node:util'
import { startBluetooth } from '../audio/index.js'
import { pickClip } from '../clip-bank.js'
import { config } from '../config.js'
import { watchEvents } from '../events.js'
import { startGeminiWarmup } from '../gemini.js'
import { createTriggerGate, onTrigger } from '../pipeline.js'
import { ask } from '../prompt.js'
import { connectRing, describeCamera, pickDoorbell, printCamera } from '../ring.js'
import { fakeEvent } from '../stubs.js'
import { CHECKPOINTS, runCheckpoint } from '../uat.js'

const { values: args } = parseArgs({
  options: {
    checkpoint: { type: 'string' },
    output: { type: 'string' },
    // Runs the prompts with one pretend trigger per scenario, touching nothing real.
    'dry-run': { type: 'boolean', default: false },
  },
})
const checkpoint = args.checkpoint
const definition = CHECKPOINTS[checkpoint]
if (!definition) throw new Error('Usage: npm run uat -- --checkpoint 1|2|3')
const output = args.output ?? definition.mode.output

// Checkpoint 1 tests hearing only: a short stock clip, with no Gemini or ElevenLabs.
const stockOptions = definition.mode.stockClipOnly
  ? { comment: async () => ({ decision: 'COMMENT', comment: 'stock clip' }), speak: async () => pickClip('cover') }
  : {}
const gate = createTriggerGate()
const fired = []

if (args['dry-run']) {
  await runCheckpoint(checkpoint, {
    ask,
    output,
    collectTriggers: async (scenario) => {
      const event = fakeEvent()
      const row = { trigger_id: event.id, event_received_at: new Date(event.receivedAt).toISOString(), first_audio_at: new Date(event.receivedAt + 1000).toISOString(), gemini_decision: 'COMMENT' }
      return [{ status: scenario.expect === 'suppressed' ? 'suppressed' : 'played', row, comment: 'dry run' }]
    },
  })
  process.exit(0)
}

const ring = await connectRing()
const camera = pickDoorbell(ring.cameras)
printCamera(describeCamera(camera))
if (!definition.mode.stockClipOnly) startGeminiWarmup()
if (output !== 'doorbell') startBluetooth()
const stop = watchEvents(camera, {
  onEvent: (event) => { fired.push(onTrigger(event, { camera, output, gate, ...stockOptions })) },
})

await runCheckpoint(checkpoint, {
  ask,
  output,
  collectTriggers: async () => {
    fired.length = 0
    await ask('  Go now. Press Return once it has finished reacting. ')
    return Promise.all(fired)
  },
})
stop()
ring.close()
console.log(`Cooldown: ${config.cooldownMs / 1000} s after the clip ends.`)
process.exit(0)
