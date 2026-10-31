import { percentile, summarizeProbe } from './probe-summary.js'

export const MEASUREMENT_COLUMNS = ['Metric', 'Target', 'Measured', 'Samples']
const NOT_MEASURED = 'not measured yet'

const numbers = (rows, column) =>
  rows.map((r) => r[column]).filter((v) => v !== '' && v !== undefined).map(Number).filter(Number.isFinite)
const seconds = (ms) => `${(ms / 1000).toFixed(2)} s`
const spread = (values) =>
  values.length ? `median ${seconds(percentile(values, 0.5))}, p95 ${seconds(percentile(values, 0.95))}, max ${seconds(percentile(values, 1))}` : NOT_MEASURED

// Fills in only what the Ring side measures. The other rows of the RFP tables
// (Gemini, ElevenLabs, end to end, Bluetooth) belong to other workers.
export function buildMeasurements({ events = [], trials = [], snapshots = [], probes = [] }) {
  const firstPushes = events.filter((e) => e.is_duplicate !== 'true')
  const motion = numbers(firstPushes.filter((e) => e.category === 'motion'), 'delay_ms')
  const press = numbers(firstPushes.filter((e) => e.category === 'ding'), 'delay_ms')
  const misses = trials.filter((t) => t.result === 'miss').length
  const fetched = snapshots.filter((s) => s.fresh === 'true')
  const fetchTimes = numbers(fetched, 'fetch_ms')
  const bySource = Object.entries(Object.groupBy(fetched, (s) => s.route)).map(([k, v]) => `${k} ${v.length}`).join(', ')
  const probe = summarizeProbe(probes)
  return [
    { Metric: 'Motion event delay (motion to event received)', Target: '≤ 3 s', Measured: motion.length ? `${spread(motion)} (Ring triggered_at to Mac; Ring and Mac clocks may differ)` : NOT_MEASURED, Samples: motion.length },
    { Metric: 'Doorbell press event delay', Target: '≤ 3 s', Measured: press.length ? `${spread(press)} (Ring triggered_at to Mac)` : NOT_MEASURED, Samples: press.length },
    { Metric: 'Event miss rate (staged trials)', Target: 'measure', Measured: trials.length ? `${misses}/${trials.length} missed` : NOT_MEASURED, Samples: trials.length },
    { Metric: 'Snapshot time and freshness', Target: '≤ 3 s, after the motion', Measured: snapshots.length ? `${spread(fetchTimes)}; ${fetched.length}/${snapshots.length} fresh images (${bySource || 'none'})` : NOT_MEASURED, Samples: snapshots.length },
    { Metric: 'Ring talk session open time', Target: '≤ 5 s', Measured: probe.speakerReadyMedianMs !== null ? `median ${seconds(probe.speakerReadyMedianMs)}, p95 ${seconds(probe.speakerReadyP95Ms)}, max ${seconds(probe.speakerReadyMaxMs)}; audio codec ${probe.codecs.join('/') || 'n/a'}` : NOT_MEASURED, Samples: probe.tries },
    { Metric: 'Doorbell audio success rate (20 tries)', Target: '≥ 90%', Measured: probe.tries ? (probe.asked ? `${probe.successes}/${probe.asked} heard at the door` : `${probe.technicalOk}/${probe.tries} clip sent, not confirmed by ear`) : NOT_MEASURED, Samples: probe.tries },
  ]
}
