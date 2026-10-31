import { createBluetoothOutput } from './bluetooth.js'
import { endActiveSession, getActiveSession, getOrOpenSession } from '../live-session.js'

const outputs = new Map()
let bluetooth = null

// Starts the speaker's keep-alive and health check, and makes it available to playAudio.
export function startBluetooth(options) {
  bluetooth = createBluetoothOutput(options)
  registerOutput('bluetooth', (source) => bluetooth.play(source))
  bluetooth.start()
  return bluetooth
}

// The Bluetooth worker plugs in with registerOutput('bluetooth', async (source, opts) => ...).
export function registerOutput(name, player) {
  outputs.set(name, player)
}

async function playOnDoorbell(source, { camera, closeAfter }) {
  const hadSession = Boolean(getActiveSession())
  if (!hadSession && !camera) throw new Error('playAudio on the doorbell needs a camera or an open session')
  const session = getOrOpenSession(camera)
  try {
    const result = await session.play(source)
    return { output: 'doorbell', ...result }
  } finally {
    if (closeAfter ?? !hadSession) endActiveSession('finished')
  }
}

/**
 * Play a file path or readable stream.
 * output 'doorbell' reuses the live call opened by the trigger if there is one, so a
 * cover clip and a comment share one continuous call. Otherwise it opens one and
 * closes it afterwards. Use closeAfter to override that.
 */
export async function playAudio(source, { output = 'doorbell', camera, closeAfter, ...rest } = {}) {
  if (output === 'doorbell') return playOnDoorbell(source, { camera, closeAfter })
  if (output === 'both') {
    throw new Error("output 'both' needs the arbitration from RFP scope item 8, which is not built yet")
  }
  const player = outputs.get(output)
  if (!player) throw new Error(`No "${output}" audio output registered. Call registerOutput first.`)
  return player(source, { camera, ...rest })
}
