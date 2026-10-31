import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { sampleRateOf } from './audio/bluetooth.js'
import { CLIPS_DIR, config } from './config.js'
import { loadToken } from './token-store.js'

const tool = (command, args) => new Promise((resolve, reject) => {
  execFile(command, args, { timeout: 15000 }, (error, stdout) => (error ? reject(error) : resolve(stdout.trim())))
})

const CALL_QUALITY_MAX_HZ = 16000
const REQUIRED_CATEGORIES = ['cover', 'fallback', 'error']

/**
 * Everything that would silently ruin a night with nobody home. Read-only.
 * FAIL means it won't work properly tonight; WARN means it works but in a lesser way.
 */
export async function runSelfCheck({ cfg = config, run = tool, clipsDir = CLIPS_DIR, hasToken = () => Boolean(loadToken()) } = {}) {
  const results = []
  const add = (status, name, detail) => results.push({ status, name, detail })

  if (hasToken()) add('OK', 'Ring', 'signed in')
  else add('FAIL', 'Ring', 'not signed in: run `npm run auth` in the Terminal app')

  if (cfg.output !== 'doorbell') {
    const name = cfg.bluetoothSpeakerName
    if (!name) add('FAIL', 'Speaker', 'BLUETOOTH_SPEAKER_NAME is not set')
    else {
      try {
        const [outputs, output, input, report] = await Promise.all([
          run('SwitchAudioSource', ['-a', '-t', 'output']), run('SwitchAudioSource', ['-c', '-t', 'output']),
          run('SwitchAudioSource', ['-c', '-t', 'input']), run('system_profiler', ['SPAudioDataType']),
        ])
        const rate = sampleRateOf(report, name)
        if (!outputs.split('\n').map((line) => line.trim()).includes(name)) add('FAIL', 'Speaker', `"${name}" is not connected: voices will come from the Mac`)
        else if (output !== name) add('FAIL', 'Speaker', `sound is going to "${output}", not "${name}"`)
        else add('OK', 'Speaker', `"${name}" is the sound output`)
        if (input === name) add('FAIL', 'Input', `"${name}" is the default mic, which forces call-quality audio`)
        else add('OK', 'Input', `"${input}"`)
        if (rate !== null && rate <= CALL_QUALITY_MAX_HZ) add('FAIL', 'Audio quality', `speaker is at ${rate} Hz call quality`)
        else if (rate !== null) add('OK', 'Audio quality', `${rate} Hz`)
      } catch (error) {
        add('FAIL', 'Speaker', `could not check it: ${error.message}. Is switchaudio-osx installed?`)
      }
    }
  }

  if (!cfg.geminiApiKey) add('FAIL', 'Gemini', 'no API key: every visitor gets a stock line')
  else if (!cfg.geminiBillingConfirmed) add('WARN', 'Gemini', 'billing not confirmed, so photos are not sent: every visitor gets a stock line')
  else add('OK', 'Gemini', cfg.geminiModel)

  if (!cfg.elevenLabsApiKey || !cfg.elevenLabsVoiceId) add('FAIL', 'ElevenLabs', 'key or voice ID missing: no new comments can be spoken')
  else add('OK', 'ElevenLabs', 'key and voice set')

  const manifestFile = path.join(clipsDir, 'manifest.json')
  if (!fs.existsSync(manifestFile)) add('FAIL', 'Clips', 'none built: run `npm run build-clips`')
  else {
    const { categories = {} } = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    const all = Object.values(categories).flat()
    const missing = all.filter((clip) => !fs.existsSync(path.join(clipsDir, clip.file))).length
    const absent = REQUIRED_CATEGORIES.filter((category) => !categories[category]?.length)
    if (missing || absent.length) add('FAIL', 'Clips', `${missing} files missing${absent.length ? `, no ${absent.join(', ')} clips` : ''}: run \`npm run build-clips\``)
    else add('OK', 'Clips', `${all.length} ready`)
  }

  try {
    await run(cfg.ffmpegPath, ['-version'])
    add('OK', 'ffmpeg', 'found')
  } catch {
    add('FAIL', 'ffmpeg', 'not found: run `brew install ffmpeg`')
  }
  return results
}

export function printSelfCheck(results, log = console.log) {
  const failed = results.filter((r) => r.status === 'FAIL')
  const warned = results.filter((r) => r.status === 'WARN')
  log('Self-check')
  for (const r of results) log(`  ${r.status.padEnd(4)}  ${r.name.padEnd(14)} ${r.detail}`)
  log('')
  if (failed.length) {
    log('*****************************************************')
    log(`*  ${failed.length} PROBLEM(S): THIS WILL NOT WORK PROPERLY TONIGHT`)
    for (const r of failed) log(`*  ${r.name}: ${r.detail}`)
    log('*****************************************************\n')
  } else if (warned.length) {
    log(`Ready, with ${warned.length} warning(s) above.\n`)
  } else {
    log('All good.\n')
  }
  return failed.length === 0
}
