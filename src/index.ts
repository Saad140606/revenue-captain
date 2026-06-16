import { loadApplications, loadEvents, loadSchoolRoutes } from "./loader.js";
import { evaluate } from "./evaluator.js";
import { loadState, saveState, recordAction, wasProcessed } from "./state.js";
import type { QueueItem } from "./types.js";

const ACTION_EMOJI: Record<string, string> = {
  FLAG_BOUNCED_ROUTE: "🔴",
  MARK_STALE: "🟠",
  REQUEST_EVIDENCE: "🟡",
  REQUEST_COMP_BID: "🟡",
  SEND_TECHNICAL_SCREEN: "🟢",
  ALREADY_SCREENED: "✅",
  SKIP_DUPLICATE: "⏭️ ",
};

function printQueue(queue: QueueItem[], newActions: Set<string>): void {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  REVENUE CAPTAIN — NEXT-ACTION QUEUE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const emoji = ACTION_EMOJI[item.action] ?? "⚪";
    const isNew = newActions.has(item.application_id) ? " [NEW]" : " [already logged]";

    console.log(`${i + 1}. ${emoji} ${item.action}${isNew}`);
    console.log(`   Candidate : ${item.candidate_name}`);
    console.log(`   School    : ${item.school}`);
    console.log(`   App ID    : ${item.application_id}`);
    console.log(`   Comp Bid  : $${item.compensation_bid_usd_month}/mo`);
    console.log(`   CT Window : ${item.ct_overlap || "—"}`);
    console.log(`   Reason    : ${item.reason}`);
    console.log();
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Total: ${queue.length} candidates | New actions: ${newActions.size}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

function main(): void {
  console.log("Loading data...");
  const applications = loadApplications();
  const events = loadEvents();
  const schoolRoutes = loadSchoolRoutes();

  console.log(
    `  ${applications.length} applications | ${events.length} events | ${schoolRoutes.length} school routes`
  );

  const queue = evaluate(applications, events, schoolRoutes);

  // Load existing state for idempotency
  let state = loadState();
  const newActions = new Set<string>();

  // Only record actions for items not already in state
  for (const item of queue) {
    if (!wasProcessed(state, item.application_id)) {
      state = recordAction(state, item.application_id, item.action);
      newActions.add(item.application_id);
    }
  }

  // Persist updated state
  saveState(state);
  console.log(`State saved to state.json (${Object.keys(state.processed).length} total records)\n`);

  printQueue(queue, newActions);
}

main();
