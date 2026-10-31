import { printStatus } from '../status.js'
import { loadToken } from '../token-store.js'

printStatus()
if (!loadToken()) {
  console.log('Nothing to listen to until you sign in to Ring. Run `npm run auth`, then `npm start`.')
  console.log('You can try the chain without Ring at any time: `npm run simulate`.')
  process.exit(0)
}
process.env.LISTEN_ARGS = '--respond'
await import('./listen.js')
