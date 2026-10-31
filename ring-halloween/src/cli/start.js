import { spawn } from 'node:child_process'
import { startBluetooth } from '../audio/index.js'
import { config, measurementPath } from '../config.js'
import { appendCsvRow } from '../csv.js'
import { startGeminiWarmup } from '../gemini.js'
import { printSelfCheck, runSelfCheck } from '../self-check.js'
import { printStatus } from '../status.js'
import { surviveErrors } from '../survive.js'
import { loadToken } from '../token-store.js'

surviveErrors()
printStatus()
if (!loadToken()) {
  console.log('Nothing to listen to until you sign in to Ring. Run `npm run auth` in the Terminal app, then `npm start`.')
  console.log('You can try the chain without Ring at any time: `npm run simulate`.')
  process.exit(0)
}
// Keeps the Mac awake for as long as this process runs.
spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref()
startGeminiWarmup()
if (config.output !== 'doorbell') {
  // Fixes what it can before the check, so the check reports what is really wrong.
  await startBluetooth().pinOutput().catch((error) => console.error(`[bluetooth] ${error.message}`))
}
const results = await runSelfCheck()
printSelfCheck(results)
for (const result of results) {
  appendCsvRow(measurementPath('self-check.csv'), ['at', 'status', 'name', 'detail'], { at: new Date().toISOString(), ...result })
}
process.env.LISTEN_ARGS = '--respond'
try {
  await import('./listen.js')
} catch (error) {
  // Often the network at startup: end with an error so that keep-running tries again.
  console.error(`Could not start: ${error.message}`)
  process.exit(1)
}
