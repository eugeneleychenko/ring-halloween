import { config } from './config.js'
import { loadToken } from './token-store.js'

// Reports whether things are set up. It must never print a key or token.
export function getStatus() {
  const on = (present) => (present ? 'key present' : 'NO KEY')
  return [
    ['Output', config.output],
    ['Ring', loadToken() ? 'signed in (token saved)' : 'not signed in: run `npm run auth`'],
    ['Gemini', `${on(config.geminiApiKey)}, ${config.geminiModel}, ${config.geminiBillingConfirmed ? 'billing confirmed' : 'billing NOT confirmed: door snapshots are not sent and a stock line plays'}`],
    ['ElevenLabs', `${on(config.elevenLabsApiKey)}, voice ${config.elevenLabsVoiceId ? 'set' : 'NOT SET'}, ${config.elevenLabsModel}`],
    ['Bluetooth speaker', config.bluetoothSpeakerName ? `${config.bluetoothSpeakerName}, the main voice` : 'NOT SET: add BLUETOOTH_SPEAKER_NAME'],
    ['Doorbell speaker', 'works but quiet, with some crackle: optional'],
  ]
}

export function printStatus(log = console.log) {
  log('Ring Halloween\n')
  for (const [name, value] of getStatus()) log(`  ${name.padEnd(18)} ${value}`)
  log('')
}
