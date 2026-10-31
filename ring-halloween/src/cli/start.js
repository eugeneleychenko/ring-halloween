import { spawn } from 'node:child_process'
import { startBluetooth } from '../audio/index.js'
import { config } from '../config.js'
import { startGeminiWarmup } from '../gemini.js'
import { printStatus } from '../status.js'
import { loadToken } from '../token-store.js'

printStatus()
if (!loadToken()) {
  console.log('Nothing to listen to until you sign in to Ring. Run `npm run auth`, then `npm start`.')
  console.log('You can try the chain without Ring at any time: `npm run simulate`.')
  process.exit(0)
}
// Keeps the Mac awake for as long as this process runs.
spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref()
startGeminiWarmup()
if (config.output !== 'doorbell') startBluetooth()
process.env.LISTEN_ARGS = '--respond'
await import('./listen.js')
