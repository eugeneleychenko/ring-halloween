import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { measurementPath } from '../config.js'
import { connectRing, describeCamera, pickDoorbell, printCamera } from '../ring.js'

export async function showDevices() {
  const ring = await connectRing()
  try {
    const infos = ring.cameras.map(describeCamera)
    console.log(`${infos.length} camera(s) on this account:\n`)
    infos.forEach((info) => printCamera(info))
    fs.writeFileSync(measurementPath('device.json'), JSON.stringify(infos, null, 2) + '\n')
    try {
      console.log(`\nThis project will use: ${pickDoorbell(ring.cameras).name}`)
    } catch (error) {
      console.log(`\nDoorbell choice: ${error.message}`)
    }
    console.log(`Saved to ${measurementPath('device.json')}`)
  } finally {
    ring.close()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  showDevices().then(() => process.exit(0)).catch((error) => {
    console.error(`Failed: ${error.message}`)
    process.exit(1)
  })
}
