import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { printSelfCheck, runSelfCheck } from '../src/self-check.js'
import { surviveErrors } from '../src/survive.js'
import { parseCsv } from '../src/csv.js'

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'night-'))
const PROFILER = (rate) => `Audio:\n\n    Devices:\n\n        SB571:\n\n          Input Channels: 1\n          Current SampleRate: 8000\n\n        SB571:\n\n          Output Channels: 2\n          Current SampleRate: ${rate}\n`
function clipsFolder() {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 'c.wav'), 'x')
  const clip = { file: 'c.wav' }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ categories: { cover: [clip], fallback: [clip], error: [clip] } }))
  return dir
}
const goodCfg = { output: 'bluetooth', bluetoothSpeakerName: 'SB571', geminiApiKey: 'k', geminiBillingConfirmed: true, geminiModel: 'm', elevenLabsApiKey: 'k', elevenLabsVoiceId: 'v', ffmpegPath: 'ffmpeg' }
const tools = ({ outputs = 'SB571\nMac Speakers', output = 'SB571', input = 'Mac Mic', rate = 44100, noFfmpeg = false } = {}) => async (command, args) => {
  if (command === 'SwitchAudioSource') return args[0] === '-a' ? outputs : args.includes('input') ? input : output
  if (command === 'system_profiler') return PROFILER(rate)
  if (command === 'ffmpeg' && noFfmpeg) throw new Error('not found')
  return ''
}
const check = (overrides = {}, tool = {}, extra = {}) => runSelfCheck({ cfg: { ...goodCfg, ...overrides }, run: tools(tool), clipsDir: extra.clipsDir ?? clipsFolder(), hasToken: extra.hasToken ?? (() => true) })
const status = (results, name) => results.find((r) => r.name === name)?.status

test('a healthy setup passes every check', async () => {
  const results = await check()
  assert.deepEqual(results.filter((r) => r.status !== 'OK'), [])
  const logged = []
  assert.equal(printSelfCheck(results, (m) => logged.push(m)), true)
  assert.ok(logged.join('\n').includes('All good'))
})

for (const [label, name, status_, args] of [
  ['Ring not signed in', 'Ring', 'FAIL', [{}, {}, { hasToken: () => false }]],
  ['speaker not connected', 'Speaker', 'FAIL', [{}, { outputs: 'Mac Speakers' }]],
  ['speaker not the default output', 'Speaker', 'FAIL', [{}, { output: 'Mac Speakers' }]],
  ['the speaker mic as input', 'Input', 'FAIL', [{}, { input: 'SB571' }]],
  ['8 kHz mode', 'Audio quality', 'FAIL', [{}, { rate: 8000 }]],
  ['Gemini gate off', 'Gemini', 'WARN', [{ geminiBillingConfirmed: false }]],
  ['no Gemini key', 'Gemini', 'FAIL', [{ geminiApiKey: null }]],
  ['no ElevenLabs voice', 'ElevenLabs', 'FAIL', [{ elevenLabsVoiceId: null }]],
  ['clips not built', 'Clips', 'FAIL', [{}, {}, { clipsDir: tempDir() }]],
  ['ffmpeg missing', 'ffmpeg', 'FAIL', [{}, { noFfmpeg: true }]],
]) {
  test(`the self-check catches: ${label}`, async () => {
    assert.equal(status(await check(...args), name), status_)
  })
}

test('a missing clip file is caught even when the manifest exists, and failures are loud', async () => {
  const clipsDir = clipsFolder()
  fs.rmSync(path.join(clipsDir, 'c.wav'))
  const results = await check({}, {}, { clipsDir })
  assert.equal(status(results, 'Clips'), 'FAIL')
  const logged = []
  assert.equal(printSelfCheck(results, (m) => logged.push(m)), false)
  assert.match(logged.join('\n'), /WILL NOT WORK PROPERLY TONIGHT/)
})

test('stray errors are logged and do not end the program', () => {
  const target = new EventEmitter()
  const file = path.join(tempDir(), 'errors.log')
  surviveErrors({ file, target, log: () => {} })
  target.emit('uncaughtException', new Error('boom'))
  target.emit('unhandledRejection', new Error('later'))
  const text = fs.readFileSync(file, 'utf8')
  assert.match(text, /uncaughtException Error: boom/)
  assert.match(text, /unhandledRejection Error: later/)
})

test('a real process survives a thrown error and a rejected promise', () => {
  const dir = tempDir()
  const code = "import {surviveErrors} from './src/survive.js';surviveErrors();setTimeout(()=>{throw new Error('boom')},10);setTimeout(()=>Promise.reject(new Error('nope')),20);setTimeout(()=>{console.log('still alive');process.exit(0)},100)"
  const result = spawnSync('bin/node24', ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, MEASUREMENTS_DIR: dir } })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /still alive/)
  assert.equal(fs.readFileSync(path.join(dir, 'errors.log'), 'utf8').trim().split('\n').filter((l) => /^\d{4}-/.test(l)).length, 2)
})

function runLoop(script, env = {}) {
  const dir = tempDir()
  const fake = path.join(dir, 'fake.sh')
  fs.writeFileSync(fake, script.replaceAll('$DIR', dir), { mode: 0o755 })
  return { dir, child: spawn('bin/keep-running', [], { env: { ...process.env, MEASUREMENTS_DIR: dir, KEEP_RUNNING_COMMAND: fake, RESTART_DELAY_SECONDS: '0', ...env }, stdio: 'ignore' }) }
}
const closed = (child) => new Promise((resolve) => child.on('close', resolve))

test('keep-running relaunches after a crash, logs it, and stops after a clean exit', async () => {
  const { dir, child } = runLoop('#!/bin/bash\nn=$(cat $DIR/n 2>/dev/null || echo 0); n=$((n+1)); echo $n > $DIR/n\n[ "$n" -lt 3 ] && exit 7\nexit 0\n')
  assert.equal(await closed(child), 0)
  assert.equal(fs.readFileSync(path.join(dir, 'n'), 'utf8').trim(), '3')
  const rows = parseCsv(fs.readFileSync(path.join(dir, 'restarts.csv'), 'utf8'))
  assert.deepEqual(rows.map((r) => [r.exit_code, r.restart_number]), [['7', '1'], ['7', '2']])
})

test('keep-running stops for good on Ctrl-C and does not relaunch', async () => {
  const { dir, child } = runLoop('#!/bin/bash\ntrap "exit 130" INT\necho run >> $DIR/runs\nwhile true; do sleep 0.05; done\n')
  await new Promise((r) => setTimeout(r, 400))
  child.kill('SIGINT')
  assert.equal(await closed(child), 0)
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(fs.readFileSync(path.join(dir, 'runs'), 'utf8').trim().split('\n').length, 1)
})
