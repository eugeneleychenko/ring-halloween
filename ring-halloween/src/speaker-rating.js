const yesNo = (name, value) => {
  if (value === undefined) return undefined
  if (value !== 'y' && value !== 'n') throw new Error(`${name} must be y or n, got "${value}"`)
  return value
}

export function applyRating(rows, { run = 'latest', tryNumber, audible, clippedStart, clippedEnd, note }) {
  if (!rows.length) throw new Error('speaker.csv has no rows yet')
  const runId = run === 'latest' ? rows.at(-1).run_id : run
  const row = rows.find((r) => r.run_id === runId && String(r.try) === String(tryNumber))
  if (!row) throw new Error(`No row for run ${runId} try ${tryNumber}`)
  const updates = { audible_2m: yesNo('--audible', audible), clipped_start: yesNo('--clipped-start', clippedStart), clipped_end: yesNo('--clipped-end', clippedEnd), note }
  for (const [key, value] of Object.entries(updates)) if (value !== undefined) row[key] = value
  return row
}
