# #12 Feasibility report, non-developer README, and demo video

| Field | Value |
|---|---|
| Type | HITL (needs Eugene present) |
| Status | blocked |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

The RFP deliverables. A 1 to 2 page feasibility report with go/no-go per scope item, the filled measurements tables, failure modes and recoveries, the recommended production setup and the risks (Ring updates, account throttling, ToS, Gemini terms). A README a non-developer can follow to run the system on the Mac. A 1 to 2 minute video of a full trigger-to-speech run at the door, on the Bluetooth route and on the doorbell route if it works.

## Acceptance criteria

- [ ] `feasibility-report.md` exported to PDF, 2 pages or fewer, with both measurements tables filled from `npm run report`
- [ ] Each of the 8 scope items (RFP 7 plus Addendum A item 8) has a go / no-go / conditional line with one sentence of evidence
- [ ] README verified by someone other than the author following it from a clean Mac user account
- [ ] Video recorded with a visible clock so motion-to-audio can be read off the footage
- [ ] Chief of staff validates the report against the research reports and the RFP before it is called done

## Blocked by

- [#11 20-trial measurement run and 3-hour soak test](11-trial-run-soak-test.md)

## Validation log

_Chief of staff fills this in. Status moves ready -> in-progress -> validate -> done._
