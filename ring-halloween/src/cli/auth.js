import { RingRestClient } from 'ring-client-api/rest-client'
import { config } from '../config.js'
import { ask, askHidden } from '../prompt.js'
import { acquireLock, loadToken, saveToken, tokenPath } from '../token-store.js'

// The library's own login flow leaves these rejected while it asks for the 2FA code.
process.on('unhandledRejection', () => {})

const MAX_2FA_TRIES = 5

async function main() {
  if (!process.stdin.isTTY) {
    throw new Error('`npm run auth` needs a real terminal so you can type your password and 2FA code.')
  }
  const release = acquireLock()
  if (loadToken()) {
    const answer = await ask('A Ring token is already saved. Replace it? (y/N) ')
    if (answer.toLowerCase() !== 'y') return
  }
  console.log('Sign in to Ring. Your email and password are used once and are not saved.\n')
  const email = await ask('Ring email: ')
  const password = await askHidden('Ring password (hidden): ')
  const client = new RingRestClient({ email, password, controlCenterDisplayName: config.controlCenterDisplayName })

  let auth
  try {
    auth = await client.getCurrentAuth()
  } catch (error) {
    if (!client.promptFor2fa) throw error
    console.log(`\n${client.promptFor2fa}`)
    for (let attempt = 1; !auth; attempt++) {
      const code = await ask('2FA code: ')
      try {
        auth = await client.getAuth(code)
      } catch {
        if (attempt >= MAX_2FA_TRIES) throw new Error('Too many wrong 2FA codes. Wait 10 minutes, then run this again.')
        console.log('That code did not work. Try again.')
      }
    }
  }
  saveToken(auth.refresh_token)
  release()
  console.log(`\nSigned in. Token saved to ${tokenPath()} (only your user can read it).\n`)

  // Lists devices through the normal path, which rotates and re-saves the token.
  const { showDevices } = await import('./devices.js')
  await showDevices()
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(`\nFailed: ${error.message}`)
  process.exit(1)
})
