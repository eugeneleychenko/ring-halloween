import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { startBluetooth } from '../audio/index.js'
import { playAudio } from '../audio/index.js'
import { createClipTrigger } from '../clip-trigger.js'
import { config } from '../config.js'
import { watchEvents, eventRow, EVENT_COLUMNS } from '../events.js'
import { measurementPath } from '../config.js'
import { appendCsvRow } from '../csv.js'
import { connectRing, describeCamera, pickDoorbell, printCamera } from '../ring.js'
import { printSelfCheck, runSelfCheck } from '../self-check.js'
import { fakeEvent } from '../stubs.js'
import { surviveErrors } from '../survive.js'

const { values: args } = parseArgs({ options: { 'self-test': { type: 'boolean', default: false } } })
surviveErrors()
spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref()

const bluetooth = startBluetooth()
await bluetooth.pinOutput()
printSelfCheck(await runSelfCheck())

if (args['self-test']) {
  const trigger = createClipTrigger({ play: playAudio })
  const result = await trigger(fakeEvent())
  console.log(`Self-test: ${result.status}, clip ${result.clip}, sample rate ${await bluetooth.checkSampleRate()} Hz`)
  process.exit(result.status === 'played' ? 0 : 1)
}

const ring = await connectRing()
const camera = pickDoorbell(ring.cameras)
printCamera(describeCamera(camera))
const trigger = createClipTrigger({ camera, play: playAudio })
watchEvents(camera, {
  onEvent(event) {
    appendCsvRow(measurementPath('events.csv'), EVENT_COLUMNS, eventRow(event))
    trigger(event).catch((error) => console.error(`[trigger] ${error.message}`))
  },
  onDuplicate(event, info) {
    appendCsvRow(measurementPath('events.csv'), EVENT_COLUMNS, eventRow(event, { isDuplicate: true, ...info }))
  },
})
console.log(`LIVE: motion plays a random clip on ${config.bluetoothSpeakerName}. Cooldown ${config.cooldownMs / 1000} s. Ctrl-C to stop.`)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    bluetooth.stop()
    ring.close()
    process.exit(130)
  })
}
