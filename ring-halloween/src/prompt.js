import readline from 'node:readline/promises'
import { Writable } from 'node:stream'

export async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

export async function askHidden(question) {
  process.stdout.write(question)
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() })
  const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true })
  try {
    return await rl.question('')
  } finally {
    rl.close()
    process.stdout.write('\n')
  }
}
