import { printSelfCheck, runSelfCheck } from '../self-check.js'

const ok = printSelfCheck(await runSelfCheck())
process.exit(ok ? 0 : 1)
