# Revenue Captain

A small pipeline worker that reads candidate applications, event history, and school/career-office routes, then produces a prioritized next-action queue. Designed to run repeatedly without creating duplicate actions.

---

## Quickstart

```bash
npm install
npm run dev        # run the worker
npm test           # run all tests
npm run run-fresh  # delete state.json and run from scratch
```

---

## Architecture

The worker follows a simple linear pipeline on every run:

```
Load data → Deduplicate → Evaluate rules → Rank queue → Persist state → Print output
```

### 1. Load (`src/loader.ts`)
Reads three JSON files from `data/`:
- `applications.json` — candidate submissions
- `events.json` — event history per candidate (screen sent, bounced, etc.)
- `school_routes.json` — how to reach each school's career office

### 2. Evaluate (`src/evaluator.ts`)
For each (deduplicated) candidate, applies ordered rules to determine one action:

| Priority | Action | Trigger |
|----------|--------|---------|
| 1 | `FLAG_BOUNCED_ROUTE` | `email_bounced` event or school route status is `bounced_route` |
| 2 | `MARK_STALE` | Submitted >7 days ago with no follow-up event |
| 3 | `REQUEST_EVIDENCE` | `artifact_url` is empty |
| 4 | `REQUEST_COMP_BID` | `compensation_bid_usd_month` is 0 or missing, or no CT overlap |
| 5 | `SEND_TECHNICAL_SCREEN` | All checks pass |
| 6 | `ALREADY_SCREENED` | `technical_screen_sent` event already exists |
| 7 | `SKIP_DUPLICATE` | Duplicate `application_id` in input |

Rule order matters: a candidate with both a bounced route and missing evidence gets `FLAG_BOUNCED_ROUTE` because fixing the route unblocks all future outreach. The rules are a decision tree, not a scoring system.

### 3. Persist state (`src/state.ts`)
After evaluation, each `application_id` → action mapping is written to `state.json`. On subsequent runs, any candidate already in `state.json` is shown as `[already logged]` but not re-actioned. This is the idempotency mechanism: running the worker twice on the same data produces the same `state.json`.

### 4. Output
The ranked queue is printed to stdout with emoji indicators and full context per candidate.

---

## Handling edge cases

- **Duplicate submissions**: Detected by repeated `application_id` in the input file. Only the first occurrence is evaluated; all subsequent ones get `SKIP_DUPLICATE`.
- **Stale candidates**: Calculated from `submitted_at` timestamp against a 7-day threshold. Configurable via `STALE_THRESHOLD_DAYS` constant in `evaluator.ts`.
- **Missing compensation bid**: Zero or null `compensation_bid_usd_month` blocks advancement to screening.
- **Bounced routes**: Checked both from the event log (`email_bounced`) and the school route status (`bounced_route`). Either is sufficient to flag.
- **School route blockers**: Routes with `portal_required: true` or `cost_blocker: true` are surfaced in the route data; the current evaluator flags `bounced_route` status. Portal and cost blockers can be added as additional rule conditions.

---

## What I would change for continuous production use

1. **Replace file I/O with a database.** Currently `state.json` is a flat file, which breaks under concurrent workers. A Postgres table with a unique index on `(application_id, action)` and an upsert would give safe concurrent writes.

2. **Stream events from a queue.** Rather than batch-reading a JSON file, the worker would consume from an event stream (SQS, Kafka, or Pub/Sub). This enables near-real-time action on new applications instead of scheduled reruns.

3. **Add a scheduler.** A cron job or workflow orchestrator (Temporal, Celery, Airflow) would trigger the worker on a defined cadence — e.g., every 15 minutes — with alerting on failures.

4. **Retry and backoff for bounced routes.** Currently a bounced route stays flagged forever. In production, the system would attempt to resolve the route (find a new contact, check the portal) and retry outreach on a schedule.

5. **Observability.** Structured JSON logs per action, metrics on queue depth per action type, and alerting when stale candidates exceed a threshold.

6. **Soft-delete rather than hard-skip for duplicates.** The duplicate detection currently discards later submissions silently. In production you'd want to log the conflict and potentially merge or escalate.

---

## Where AI helped

Claude (claude-sonnet-4-6) was used to:
- Scaffold the initial TypeScript module structure and type definitions
- Suggest the priority ordering for the action rules
- Generate the test helper functions (`makeApp`, `makeEvent`, `makeRoute`)

All logic — the rule ordering, idempotency mechanism, and edge case handling — was authored and verified by me. I used the AI output as a starting point and modified it substantially during testing.

---

## Project structure

```
revenue-captain/
├── data/
│   ├── applications.json     # candidate submissions (includes duplicates + edge cases)
│   ├── events.json           # event history per candidate
│   └── school_routes.json    # career office / route data per school
├── src/
│   ├── types.ts              # all TypeScript interfaces and action types
│   ├── loader.ts             # reads JSON files from disk
│   ├── evaluator.ts          # core rule engine → produces ranked QueueItem[]
│   ├── state.ts              # load/save/check state.json for idempotency
│   └── index.ts              # entry point: wires everything together
├── tests/
│   └── captain.test.ts       # 7 unit tests (no external test framework)
├── state.json                # generated on first run (gitignored)
├── package.json
├── tsconfig.json
└── README.md
```
