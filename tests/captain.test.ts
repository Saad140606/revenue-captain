import { evaluate } from "../src/evaluator.js";
import { loadState, recordAction, wasProcessed, saveState } from "../src/state.js";
import type { Application, CandidateEvent, SchoolRoute, PersistedState } from "../src/types.js";
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeApp(overrides: Partial<Application> = {}): Application {
  return {
    application_id: "test-app-001",
    candidate_name: "Test Candidate",
    school: "Test University",
    program: "BS CS",
    submitted_at: new Date().toISOString(),
    artifact_url: "https://example.com/artifact",
    technical_evidence: "Built something solid.",
    compensation_bid_usd_month: 1500,
    ct_overlap: "09:00-14:00 CT",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CandidateEvent> = {}): CandidateEvent {
  return {
    event_id: "evt-test",
    application_id: "test-app-001",
    type: "application_received",
    occurred_at: new Date().toISOString(),
    channel: "web",
    evidence: "complete_packet",
    ...overrides,
  };
}

function makeRoute(overrides: Partial<SchoolRoute> = {}): SchoolRoute {
  return {
    source_lane_id: "school-test",
    source_type: "career_office",
    institution: "Test University",
    route: "email",
    contact: "careers@test.edu",
    portal_required: false,
    cost_blocker: false,
    last_contact_at: new Date().toISOString(),
    status: "active",
    ...overrides,
  };
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`         ${message}`);
    failed++;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  REVENUE CAPTAIN — TEST SUITE");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// Test 1: Duplicate submission
test("Duplicate candidate — only first submission is processed", () => {
  const app = makeApp();
  const duplicate = makeApp({ candidate_name: "Test Candidate (resubmit)" });
  const apps = [app, duplicate]; // same application_id
  const queue = evaluate(apps, [], [makeRoute()]);

  const nonDupeItems = queue.filter((i) => i.action !== "SKIP_DUPLICATE");
  const dupeItems = queue.filter((i) => i.action === "SKIP_DUPLICATE");

  assert.strictEqual(nonDupeItems.length, 1, "Should have exactly one non-duplicate entry");
  assert.strictEqual(dupeItems.length, 1, "Should have exactly one SKIP_DUPLICATE entry");
  assert.ok(
    dupeItems[0].reason.includes("Duplicate"),
    "Duplicate reason should mention 'Duplicate'"
  );
});

// Test 2: Stale candidate
test("Stale candidate — submitted > 7 days ago with no follow-up", () => {
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - 10); // 10 days ago

  const app = makeApp({ submitted_at: staleDate.toISOString() });
  const queue = evaluate([app], [makeEvent()], [makeRoute()]);

  const item = queue.find((i) => i.application_id === "test-app-001");
  assert.ok(item, "Candidate should be in queue");
  assert.strictEqual(item!.action, "MARK_STALE", `Expected MARK_STALE, got ${item!.action}`);
});

// Test 3: Missing evidence (no artifact URL)
test("Missing evidence — empty artifact_url triggers REQUEST_EVIDENCE", () => {
  const app = makeApp({ artifact_url: "" });
  const queue = evaluate([app], [makeEvent()], [makeRoute()]);

  const item = queue.find((i) => i.application_id === "test-app-001");
  assert.ok(item, "Candidate should be in queue");
  assert.strictEqual(
    item!.action,
    "REQUEST_EVIDENCE",
    `Expected REQUEST_EVIDENCE, got ${item!.action}`
  );
});

// Test 4: Bounced route
test("Bounced route — email_bounced event triggers FLAG_BOUNCED_ROUTE", () => {
  const app = makeApp();
  const bouncedEvent = makeEvent({ type: "email_bounced" });
  const route = makeRoute({ status: "bounced_route" });
  const queue = evaluate([app], [makeEvent(), bouncedEvent], [route]);

  const item = queue.find((i) => i.application_id === "test-app-001");
  assert.ok(item, "Candidate should be in queue");
  assert.strictEqual(
    item!.action,
    "FLAG_BOUNCED_ROUTE",
    `Expected FLAG_BOUNCED_ROUTE, got ${item!.action}`
  );
});

// Test 5: Idempotent rerun — running twice produces same state
test("Idempotent rerun — second run does not create duplicate actions", () => {
  const tmpState = path.resolve(process.cwd(), "state.test-idempotent.json");

  // Clean up before test
  if (fs.existsSync(tmpState)) fs.unlinkSync(tmpState);

  let state: PersistedState = { last_run_at: "", processed: {} };

  // First run
  const app = makeApp({ application_id: "idempotent-001" });
  const queue = evaluate([app], [makeEvent({ application_id: "idempotent-001" })], [makeRoute()]);

  for (const item of queue) {
    if (!wasProcessed(state, item.application_id)) {
      state = recordAction(state, item.application_id, item.action);
    }
  }

  const firstRunCount = Object.keys(state.processed).length;
  const firstRunAction = state.processed["idempotent-001"].action;

  // Second run — same data
  for (const item of queue) {
    if (!wasProcessed(state, item.application_id)) {
      state = recordAction(state, item.application_id, item.action);
    }
  }

  const secondRunCount = Object.keys(state.processed).length;
  const secondRunAction = state.processed["idempotent-001"].action;

  assert.strictEqual(firstRunCount, secondRunCount, "State should not grow on second run");
  assert.strictEqual(firstRunAction, secondRunAction, "Action should not change on second run");
});

// Test 6: Already screened — no action emitted
test("Already screened — technical_screen_sent event suppresses new action", () => {
  const app = makeApp();
  const screenedEvent = makeEvent({ type: "technical_screen_sent" });
  const queue = evaluate([app], [makeEvent(), screenedEvent], [makeRoute()]);

  const item = queue.find((i) => i.application_id === "test-app-001");
  assert.ok(item, "Candidate should still appear in queue");
  assert.strictEqual(
    item!.action,
    "ALREADY_SCREENED",
    `Expected ALREADY_SCREENED, got ${item!.action}`
  );
});

// Test 7: Missing comp bid
test("Missing comp bid — zero compensation triggers REQUEST_COMP_BID", () => {
  const app = makeApp({ compensation_bid_usd_month: 0 });
  const queue = evaluate([app], [makeEvent()], [makeRoute()]);

  const item = queue.find((i) => i.application_id === "test-app-001");
  assert.ok(item, "Candidate should be in queue");
  assert.strictEqual(
    item!.action,
    "REQUEST_COMP_BID",
    `Expected REQUEST_COMP_BID, got ${item!.action}`
  );
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(
  `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

if (failed > 0) {
  process.exit(1);
}
