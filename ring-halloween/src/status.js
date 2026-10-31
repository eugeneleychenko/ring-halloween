import { config } from './config.js'
import { loadToken } from './token-store.js'

// Reports whether things are set up. It must never print a key or token.
export function getStatus() {
  const on = (present) => (present ? 'key present' : 'NO KEY');
  return [
    ['Output', config.output],
    ['Ring', loadToken() ? 'signed in (token saved)' : 'not signed in: run `npm run auth`'],
    ['Gemini', `${on(config.geminiApiKey)}, using a fixed test comment until issue #07`],
    ['ElevenLabs', `${on(config.elevenLabsApiKey)}, voice ${config.elevenLabsVoiceId ? 'set' : 'NOT SET'}, using a fixed test clip until issue #08`],
    ['Bluetooth speaker', 'not built yet (issue #04): plays nothing'],
    ['Doorbell speaker', 'not proven yet (issue #05)'],
  ]
}

export function printStatus(log = console.log) {
  log('Ring Halloween\n')
  for (const [name, value] of getStatus()) log(`  ${name.padEnd(18)} ${value}`)
  log('')
}
