import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import fs from 'node:fs'
import test from 'node:test'
import { createBluetoothOutput, sampleRateOf } from '../src/audio/bluetooth.js'

function setup({ outputs = ['SB571', 'MacBook Air Speakers'], current = 'SB571', input = 'MacBook Air Microphone', rate = 44100, onConnect = () => {} } = {}) {
  const state = { outputs: [...outputs], current, input, rate, calls: [], played: [], rows: [], warnings: [], volume: null }
  const run = async (command, args) => {
    state.calls.push([command, ...args].join(' '))
    if (command === 'blueutil') { onConnect(state); return '' }
    if (command === 'osascript') { state.volume = args[1]; return '' }
    if (command === 'system_profiler') return `Audio:\n\n    Devices:\n\n        SB571:\n\n          Input Channels: 1\n          Current SampleRate: 8000\n\n        SB571:\n\n          Output Channels: 2\n          Current SampleRate: ${state.rate}\n\n        Other:\n\n          Output Channels: 2\n          Current SampleRate: 48000\n`
    const isInput = args.includes('input')
    if (args[0] === '-a') return isInput ? ['SB571', 'MacBook Air Microphone'].join('\n') : state.outputs.join('\n')
    if (args[0] === '-c') return isInput ? state.input : state.current
    if (args[0] === '-s') { if (isInput) state.input = args[1]; else state.current = args[1]; return '' }
    throw new Error('unexpected')
  }
  const output = createBluetoothOutput({
    speakerName: 'SB571', speakerAddress: '00:11:67:D3:78:E6', run, volume: 80,
    player: async (file) => { state.played.push({ file, device: state.current }) },
    log: (m) => state.warnings.push(m), writeLog: (r) => state.rows.push(r), keepAliveMs: 1e6, healthCheckMs: 1e6, keepAliveFile: 'keepalive.wav',
  })
  return { state, output }
}

test('a normal play goes to the pinned speaker and logs it', async () => {
  const { state, output } = setup()
  const result = await output.play('clip.wav')
  assert.equal(result.device, 'SB571')
  assert.equal(result.fallback, false)
  assert.deepEqual(state.played, [{ file: 'clip.wav', device: 'SB571' }])
  assert.equal(state.rows.at(-1).kind, 'play')
  assert.equal(state.warnings.length, 0)
})

test('a wrong output is corrected before playing, and the mismatch is logged', async () => {
  const { state, output } = setup({ current: 'MacBook Air Speakers' })
  await output.play('clip.wav')
  assert.equal(state.played[0].device, 'SB571')
  assert.ok(state.rows.some((r) => r.kind === 'output_corrected'))
})

test('a failed switch is an error, never a silent play on the wrong device', async () => {
  const { state, output } = setup({ current: 'Other' })
  const stuck = createBluetoothOutput({
    speakerName: 'SB571', log: () => {}, writeLog: () => {},
    player: async () => assert.fail('must not play'),
    run: async (c, a) => (a[0] === '-a' ? 'SB571\nMacBook Air Speakers' : a[0] === '-c' ? 'Other' : ''),
  })
  await assert.rejects(stuck.play('clip.wav'), /Could not switch/)
  assert.equal(state.played.length, 0)
  assert.ok(output)
})

test('an unreachable speaker tries a reconnect, then falls back to the Mac with a warning', async () => {
  const { state, output } = setup({ outputs: ['MacBook Air Speakers'], current: 'MacBook Air Speakers' })
  const result = await output.play('clip.wav')
  assert.ok(state.calls.includes('blueutil --connect 00:11:67:D3:78:E6'))
  assert.equal(result.fallback, true)
  assert.equal(result.device, 'MacBook Air Speakers')
  assert.ok(state.rows.some((r) => r.kind === 'fallback'))
})

test('a reconnect that works plays on the speaker, not the Mac', async () => {
  const { state, output } = setup({ outputs: ['MacBook Air Speakers'], current: 'MacBook Air Speakers', onConnect: (s) => s.outputs.push('SB571') })
  const result = await output.play('clip.wav')
  assert.equal(result.fallback, false)
  assert.equal(state.played[0].device, 'SB571')
})

test('the health check reconnects a dropped speaker and repins output, logging both', async () => {
  const { state, output } = setup({ outputs: ['MacBook Air Speakers'], current: 'MacBook Air Speakers', onConnect: (s) => s.outputs.push('SB571') })
  assert.equal(await output.healthCheck(), true)
  assert.equal(state.current, 'SB571')
  assert.deepEqual(state.rows.filter((r) => ['speaker_lost', 'reconnected'].includes(r.kind)).map((r) => r.kind), ['speaker_lost', 'reconnected'])
  const gone = setup({ outputs: ['MacBook Air Speakers'] })
  assert.equal(await gone.output.healthCheck(), false)
})

test('two plays run one after the other and never overlap', async () => {
  const order = []
  const output = createBluetoothOutput({
    speakerName: 'SB571', log: () => {}, writeLog: () => {},
    run: async (_c, a) => (a[0] === '-a' ? 'SB571' : a[0] === '-c' && a.includes('output') ? 'SB571' : a[0] === '-c' ? 'Mic' : ''),
    player: async (file) => { order.push(`start ${file}`); await new Promise((r) => setTimeout(r, 30)); order.push(`end ${file}`) },
  })
  await Promise.all([output.play('cover.wav'), output.play('comment.wav')])
  assert.deepEqual(order, ['start cover.wav', 'end cover.wav', 'start comment.wav', 'end comment.wav'])
})

test('one failed clip does not block the next', async () => {
  let first = true
  const output = createBluetoothOutput({
    speakerName: 'SB571', log: () => {}, writeLog: () => {},
    run: async (_c, a) => (a[0] === '-a' ? 'SB571' : a[0] === '-c' && a.includes('output') ? 'SB571' : a[0] === '-c' ? 'Mic' : ''),
    player: async () => { if (first) { first = false; throw new Error('afplay exited') } },
  })
  await assert.rejects(output.play('bad.wav'), /afplay/)
  assert.equal((await output.play('good.wav')).device, 'SB571')
})

test('the keep-alive plays quietly when idle, and stays out of the way when not', async () => {
  const { state, output } = setup()
  await output.keepAlive()
  assert.deepEqual(state.played.map((p) => p.file), ['keepalive.wav'])
  const gone = setup({ outputs: ['MacBook Air Speakers'] })
  await gone.output.keepAlive()
  assert.equal(gone.state.played.length, 0, 'no keep-alive through the Mac speaker')
})

test('a stream is saved to a temporary file, played and cleaned up', async () => {
  const { state, output } = setup()
  let seen = null
  const streaming = createBluetoothOutput({
    speakerName: 'SB571', log: () => {}, writeLog: () => {},
    run: async (_c, a) => (a[0] === '-a' ? 'SB571' : a[0] === '-c' && a.includes('output') ? 'SB571' : a[0] === '-c' ? 'Mic' : ''),
    player: async (file) => { seen = { file, bytes: fs.readFileSync(file).length } },
  })
  await streaming.play(Readable.from([Buffer.from('hello')]))
  assert.equal(seen.bytes, 5)
  assert.equal(fs.existsSync(seen.file), false)
  assert.ok(state && output)
})

test('the speaker mic as default input is switched off before playing, and logged', async () => {
  const { state, output } = setup({ input: 'SB571' })
  await output.play('clip.wav')
  assert.equal(state.input, 'MacBook Air Microphone')
  assert.ok(state.rows.some((r) => r.kind === 'input_corrected'))
  assert.equal(state.played.length, 1)
})

test('the configured volume is set before playing', async () => {
  const { state, output } = setup()
  await output.play('clip.wav')
  assert.equal(state.volume, 'set volume output volume 80')
})

test('the health check spots 8 kHz call quality and fixes the input', async () => {
  const { state, output } = setup({ rate: 8000, input: 'MacBook Air Microphone' })
  assert.equal(await output.checkSampleRate(), 8000)
  assert.ok(state.rows.some((r) => r.kind === 'call_quality'))
  const healthy = setup()
  assert.equal(await healthy.output.checkSampleRate(), 44100)
  assert.equal(healthy.state.rows.length, 0)
})

test('the output and input are both re-pinned after a reconnect', async () => {
  const { state, output } = setup({ outputs: ['MacBook Air Speakers'], current: 'MacBook Air Speakers', input: 'SB571', onConnect: (s) => s.outputs.push('SB571') })
  assert.equal(await output.healthCheck(), true)
  assert.equal(state.current, 'SB571')
  assert.equal(state.input, 'MacBook Air Microphone')
})

test('the sample rate comes from the output entry, not the speaker mic that macOS lists first', () => {
  // Shape copied from real `system_profiler SPAudioDataType` output on this Mac.
  const report = 'Audio:\n\n    Devices:\n\n        MacBook Air Microphone:\n\n          Input Channels: 1\n          Current SampleRate: 48000\n\n        SB571:\n\n          Input Channels: 1\n          Manufacturer: Apple Inc.\n          Current SampleRate: 8000\n          Transport: Bluetooth\n\n        SB571:\n\n          Default Output Device: Yes\n          Output Channels: 2\n          Current SampleRate: 44100\n          Transport: Bluetooth\n'
  assert.equal(sampleRateOf(report, 'SB571'), 44100)
  assert.equal(sampleRateOf(report.replace('44100', '8000'), 'SB571'), 8000)
  assert.equal(sampleRateOf(report, 'Missing'), null)
})
