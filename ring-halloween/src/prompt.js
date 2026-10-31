import readline from 'node:readline/promises'

export async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

// Echo goes off before the prompt appears, so that text typed or pasted the moment
// the prompt shows can't reach the screen. Nothing is ever written back.
export function askHidden(question) {
  const { stdin, stdout } = process
  if (!stdin.isTTY) return Promise.reject(new Error('A hidden prompt needs a real terminal'))
  stdin.setRawMode(true)
  stdin.resume()
  stdout.write(question)
  return new Promise((resolve) => {
    let answer = ''
    const finish = (value) => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
      resolve(value)
    }
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return finish(answer)
        if (ch === '\u0003') {
          stdin.setRawMode(false)
          stdout.write('\n')
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') answer = [...answer].slice(0, -1).join('')
        else if (ch >= ' ') answer += ch
      }
    }
    stdin.on('data', onData)
  })
}
