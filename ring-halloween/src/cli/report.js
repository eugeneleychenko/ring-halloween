import { measurementPath } from '../config.js'
import { readCsv, writeCsv } from '../csv.js'
import { buildMeasurements, MEASUREMENT_COLUMNS } from '../measurements.js'

const rows = buildMeasurements({
  events: readCsv(measurementPath('events.csv')),
  trials: readCsv(measurementPath('event-trials.csv')),
  snapshots: readCsv(measurementPath('snapshots.csv')),
  probes: readCsv(measurementPath('speaker.csv')),
})
const file = measurementPath('measurements.csv')
writeCsv(file, MEASUREMENT_COLUMNS, rows)
for (const row of rows) console.log(`${row.Metric}\n  target: ${row.Target}\n  measured: ${row.Measured}`)
console.log(`\nSaved to ${file}`)
