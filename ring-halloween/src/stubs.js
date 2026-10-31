import fs from 'node:fs'
import path from 'node:path'
import { ASSETS_DIR } from './config.js'

// Stand-ins that touch no network and no hardware, for `npm run simulate`.
export async function stubSnapshot(_event) {
  return {
    jpegBuffer: fs.readFileSync(path.join(ASSETS_DIR, 'stub-snapshot.jpg')),
    takenAt: Date.now(),
    source: 'stub',
  }
}

export async function stubPlayAudio(_input, { output } = {}) {
  return { output, firstAudioAt: Date.now() }
}

export function fakeEvent({ now = Date.now() } = {}) {
  return {
    id: `sim-${now}`,
    type: 'motion',
    receivedAt: now,
    triggeredAt: now - 1,
    eventAt: now - 1,
    snapshotUuid: null,
  }
}
