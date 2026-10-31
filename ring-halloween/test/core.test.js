import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseCsv, toCsvLine } from '../src/csv.js'
import { createEventRouter, toMs } from '../src/events.js'
import { createTriggerGate, onTrigger, RUN_COLUMNS } from '../src/pipeline.js'
import { summarizeProbe } from '../src/probe-summary.js'
import { acquireLock, loadToken, saveToken, tokenPath } from '../src/token-store.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ring-halloween-test-'))

function runScript(script, env = {}) {
  return spawnSync('bin/node24', [script], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } })
}

test('simulate writes one row with the exact agreed columns, offline', () => {
  const dir = tempDir()
  const env = { MEASUREMENTS_DIR: dir, RING_TOKEN_DIR: dir, OUTPUT: 'bluetooth' }
  assert.equal(runScript('src/cli/simulate.js', env).status, 0)
  assert.equal(runScript('src/cli/simulate.js', env).status, 0)
  const text = fs.readFileSync(path.join(dir, 'runs.csv'), 'utf8')
  assert.equal(text.split('\n')[0], 'trigger_id,trigger_at,event_received_at,snapshot_at,snapshot_route,gemini_ms,gemini_decision,tts_ms,output,session_open_ms,first_audio_at,success,error')
  const rows = parseCsv(text)
  assert.equal(rows.length, 2, 'appends, one header only')
  assert.match(rows[0].trigger_id, /^sim-/)
  assert.equal(rows[0].success, 'true')
  assert.equal(rows[0].gemini_decision, 'COMMENT')
  assert.equal(rows[0].output, 'bluetooth')
})

test('status output never contains secret values', () => {
  const dir = tempDir()
  const secret = 'SECRET-VALUE-do-not-print'
  saveToken(secret, dir)
  const result = runScript('src/cli/simulate.js', {
    MEASUREMENTS_DIR: dir, RING_TOKEN_DIR: dir,
    GEMINI_API_KEY: secret, ELEVENLABS_API_KEY: secret, ELEVENLABS_VOICE_ID: secret,
  })
  assert.equal(result.status, 0)
  assert.ok(!(result.stdout + result.stderr).includes(secret))
  assert.ok(!fs.readFileSync(path.join(dir, 'runs.csv'), 'utf8').includes(secret))
})

test('npm start without a token explains the next step and exits cleanly', () => {
  const dir = tempDir()
  const result = runScript('src/cli/start.js', { RING_TOKEN_DIR: dir, MEASUREMENTS_DIR: dir })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /not signed in/)
  assert.match(result.stdout, /npm run auth/)
})

test('.env.example names every setting the code reads', () => {
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')
  const read = new Set()
  for (const file of fs.globSync('src/**/*.js', { cwd: ROOT })) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8')
    for (const m of code.matchAll(/process\.env\.([A-Z0-9_]+)|num\('([A-Z0-9_]+)'/g)) read.add(m[1] ?? m[2])
  }
  read.delete('LISTEN_ARGS') // internal, set by npm start
  assert.ok(read.size > 10)
  for (const name of read) assert.match(example, new RegExp(`\\b${name}=`), `${name} missing`)
})

test('private files are gitignored, checked by git itself', () => {
  const dir = tempDir()
  execFileSync('git', ['init', '-q'], { cwd: dir })
  fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(dir, '.gitignore'))
  const paths = ['.env', 'ring-token.json', 'snapshots/a.jpg', 'measurements/runs.csv', '.ring.lock']
  const ignored = (name) => spawnSync('git', ['check-ignore', '-q', name], { cwd: dir }).status === 0
  for (const name of paths) assert.ok(ignored(name), name)
  assert.ok(!ignored('.env.example'))
})

test('token is saved owner-only, replaced atomically, and loads back', () => {
  const dir = tempDir()
  saveToken('one', dir)
  saveToken('two', dir)
  assert.equal(loadToken(dir), 'two')
  assert.equal(fs.statSync(tokenPath(dir)).mode & 0o777, 0o600)
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp')), [])
  assert.equal(path.basename(tokenPath(dir)), 'ring-token.json')
})

test('a second process cannot take the token lock, and a dead owner does not block', () => {
  const dir = tempDir()
  const lock = path.join(dir, '.ring.lock')
  fs.writeFileSync(lock, String(process.ppid))
  assert.throws(() => acquireLock(dir), /Another ring-halloween command/)
  const child = spawnSync('bin/node24', ['-p', 'process.pid'], { cwd: ROOT, encoding: 'utf8' })
  fs.writeFileSync(lock, child.stdout.trim())
  const release = acquireLock(dir)
  release()
  assert.ok(!fs.existsSync(lock))
})

test('csv round-trips quotes, commas and newlines', () => {
  const line = toCsvLine(['a,b', 'say "hi"', 'two\nlines', null])
  assert.deepEqual(parseCsv(`w,x,y,z\n${line}\n`)[0], { w: 'a,b', x: 'say "hi"', y: 'two\nlines', z: '' })
})

const push = (id, extra = {}) => ({
  android_config: { category: 'com.ring.pn.live-event.motion' },
  analytics: { triggered_at: 1793000000000, sent_at: 1793000000084 },
  data: { device: { e2ee_enabled: false }, event: { ding: { id, subtype: 'human' }, eventito: { type: 'human', timestamp: 1793000000010 } } },
  ...extra,
})

test('a second push for one ding merges into it and delivers the snapshot UUID', async () => {
  const fired = []
  const duplicates = []
  const route = createEventRouter({}, { onEvent: (e) => fired.push(e), onDuplicate: (e) => duplicates.push(e), now: () => 1793000001000 })
  route(push('1'))
  assert.equal(fired[0].snapshotUuid, null)
  const waiting = fired[0].waitForSnapshotUuid(1000)
  route(push('1', { img: { snapshot_uuid: 'abc' } }))
  assert.equal(await waiting, 'abc')
  assert.equal(fired.length, 1)
  assert.equal(duplicates.length, 1)
  route(push('2'))
  assert.equal(fired.length, 2, 'a different ding within the 65 s window still fires')
  assert.equal(fired[0].eventAt, 1793000000000)
  route({ android_config: { category: 'something.else' } })
  assert.equal(fired.length, 2)
})

test('toMs accepts milliseconds, seconds and ISO text', () => {
  assert.equal(toMs(1793000000000), 1793000000000)
  assert.equal(toMs('1793000000'), 1793000000000)
  assert.equal(toMs('2026-10-31T00:00:00.000Z'), Date.parse('2026-10-31T00:00:00.000Z'))
  assert.equal(toMs(null), null)
})

test('the gate blocks while busy and through the cooldown', () => {
  let t = 0
  const gate = createTriggerGate({ cooldownMs: 15000, now: () => t })
  assert.equal(gate.tryEnter().allowed, true)
  assert.equal(gate.tryEnter().reason, 'busy')
  gate.release()
  t = 14999
  assert.equal(gate.tryEnter().reason, 'cooldown')
  t = 15000
  assert.equal(gate.tryEnter().allowed, true)
})

test('onTrigger logs suppressed, SKIP and failure runs', async () => {
  assert.equal(RUN_COLUMNS.length, 13)
  const base = { log: () => {}, storeSnapshot: null, openSession: () => null, output: 'bluetooth', snapshot: async () => ({ jpegBuffer: Buffer.from('x'), takenAt: 1 }) }
  const event = { id: 'e', receivedAt: 2, triggeredAt: 1 }

  const blocked = await onTrigger(event, { ...base, gate: { tryEnter: () => ({ allowed: false, reason: 'cooldown' }) } })
  assert.equal(blocked.status, 'suppressed')
  assert.equal(blocked.row.error, 'suppressed: cooldown')

  const open = () => ({ tryEnter: () => ({ allowed: true }), release() {} })
  const skipped = await onTrigger(event, { ...base, gate: open(), comment: async () => ({ decision: 'SKIP' }), play: async () => assert.fail('SKIP must not play') })
  assert.equal(skipped.status, 'skipped')

  const failed = await onTrigger(event, { ...base, gate: open(), comment: async () => ({ decision: 'COMMENT', comment: 'hi' }), speak: async () => 'x.wav', play: async () => { throw new Error('no speaker') } })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.row.success, false)
  assert.equal(failed.row.error, 'no speaker')
})

test('the probe never reports GO unless a person heard it', () => {
  const rows = Array.from({ length: 5 }, () => ({ success: 'true', session_open_ms: '3000', audible_2m: '' }))
  assert.equal(summarizeProbe(rows).verdict, 'UNCONFIRMED')
  assert.equal(summarizeProbe(rows.map((r) => ({ ...r, audible_2m: 'y' }))).verdict, 'GO')
  assert.equal(summarizeProbe(rows.map((r) => ({ ...r, audible_2m: 'n' }))).verdict, 'NO-GO')
  assert.equal(summarizeProbe(rows.map((r) => ({ ...r, success: 'false' }))).verdict, 'NO-GO')
  assert.equal(summarizeProbe(rows.map((r) => ({ ...r, audible_2m: 'y', session_open_ms: '9000' }))).verdict, 'CONDITIONAL')
})
