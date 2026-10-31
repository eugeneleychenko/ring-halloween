import { parseArgs } from 'node:util'
import { measurementPath } from '../config.js'
import { readCsv, writeCsv } from '../csv.js'
import { PROBE_COLUMNS } from '../probe-summary.js'
import { applyRating } from '../speaker-rating.js'

// For when someone at the door relays their ratings, instead of using `--ask`.
const { values: args } = parseArgs({
  options: {
    run: { type: 'string', default: 'latest' },
    try: { type: 'string' },
    audible: { type: 'string' },
    'clipped-start': { type: 'string' },
    'clipped-end': { type: 'string' },
    note: { type: 'string' },
  },
})
const file = measurementPath('speaker.csv')
const rows = readCsv(file)
const updated = applyRating(rows, { run: args.run, tryNumber: args.try, audible: args.audible, clippedStart: args['clipped-start'], clippedEnd: args['clipped-end'], note: args.note })
writeCsv(file, PROBE_COLUMNS, rows)
console.log(`Rated run ${updated.run_id} try ${updated.try}: audible ${updated.audible_2m}, clipped start ${updated.clipped_start}, clipped end ${updated.clipped_end}${updated.note ? `, "${updated.note}"` : ''}`)
