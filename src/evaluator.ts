import type {
  Application,
  CandidateEvent,
  SchoolRoute,
  QueueItem,
  ActionType,
} from "./types.js";

// Candidates not touched in this many days are considered stale
const STALE_THRESHOLD_DAYS = 7;

// Priority map — lower number = higher priority in the queue
const ACTION_PRIORITY: Record<ActionType, number> = {
  FLAG_BOUNCED_ROUTE: 1,
  MARK_STALE: 2,
  REQUEST_EVIDENCE: 3,
  REQUEST_COMP_BID: 4,
  SEND_TECHNICAL_SCREEN: 5,
  ALREADY_SCREENED: 6,
  SKIP_DUPLICATE: 7,
};

function daysSince(isoDate: string, now: Date): number {
  const then = new Date(isoDate);
  return (now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24);
}

export function evaluate(
  applications: Application[],
  events: CandidateEvent[],
  schoolRoutes: SchoolRoute[],
  now: Date = new Date()
): QueueItem[] {
  // Deduplicate applications — keep only the first occurrence of each application_id
  const seen = new Set<string>();
  const dedupedApps: Application[] = [];
  const duplicateIds = new Set<string>();

  for (const app of applications) {
    if (seen.has(app.application_id)) {
      duplicateIds.add(app.application_id);
    } else {
      seen.add(app.application_id);
      dedupedApps.push(app);
    }
  }

  // Index events by application_id
  const eventsByApp = new Map<string, CandidateEvent[]>();
  for (const ev of events) {
    if (!eventsByApp.has(ev.application_id)) {
      eventsByApp.set(ev.application_id, []);
    }
    eventsByApp.get(ev.application_id)!.push(ev);
  }

  // Index school routes by institution name (lowercase for loose match)
  const routeBySchool = new Map<string, SchoolRoute>();
  for (const route of schoolRoutes) {
    routeBySchool.set(route.institution.toLowerCase(), route);
  }

  const queue: QueueItem[] = [];

  for (const app of dedupedApps) {
    const appEvents = eventsByApp.get(app.application_id) ?? [];
    const eventTypes = new Set(appEvents.map((e) => e.type));
    const route = routeBySchool.get(app.school.toLowerCase());

    let action: ActionType;
    let reason: string;

    // Rule 1: Already screened — nothing more to do
    if (eventTypes.has("technical_screen_sent")) {
      action = "ALREADY_SCREENED";
      reason = "Technical screen already sent — no duplicate action needed.";
    }
    // Rule 2: Bounced route — outreach is broken, fix before anything else
    else if (eventTypes.has("email_bounced") || route?.status === "bounced_route") {
      action = "FLAG_BOUNCED_ROUTE";
      reason = `Email bounced or school route marked as bounced (${route?.contact ?? "unknown contact"}). Update route before outreach.`;
    }
    // Rule 3: Stale — submitted too long ago with no follow-up
    else if (daysSince(app.submitted_at, now) > STALE_THRESHOLD_DAYS) {
      action = "MARK_STALE";
      reason = `Submitted ${Math.floor(daysSince(app.submitted_at, now))} days ago with no follow-up action recorded.`;
    }
    // Rule 4: Missing artifact / evidence
    else if (!app.artifact_url || app.artifact_url.trim() === "") {
      action = "REQUEST_EVIDENCE";
      reason = "No artifact URL provided. Cannot evaluate technical ability without evidence.";
    }
    // Rule 5: Missing compensation bid
    else if (!app.compensation_bid_usd_month || app.compensation_bid_usd_month <= 0) {
      action = "REQUEST_COMP_BID";
      reason = "Compensation bid is missing or zero. Required before advancing to screen.";
    }
    // Rule 6: Missing availability window
    else if (!app.ct_overlap || app.ct_overlap.trim() === "") {
      action = "REQUEST_COMP_BID"; // treat as blocking info missing
      reason = "No CT overlap window provided. Cannot schedule technical oral without availability.";
    }
    // Rule 7: All clear — send the screen
    else {
      action = "SEND_TECHNICAL_SCREEN";
      reason = "Complete packet received. Ready to send technical screen.";
    }

    queue.push({
      application_id: app.application_id,
      candidate_name: app.candidate_name,
      school: app.school,
      action,
      reason,
      priority: ACTION_PRIORITY[action],
      compensation_bid_usd_month: app.compensation_bid_usd_month,
      ct_overlap: app.ct_overlap,
    });
  }

  // Emit SKIP_DUPLICATE entries at the bottom for transparency
  for (const dupId of duplicateIds) {
    const original = dedupedApps.find((a) => a.application_id === dupId);
    if (original) {
      queue.push({
        application_id: dupId,
        candidate_name: original.candidate_name + " (duplicate)",
        school: original.school,
        action: "SKIP_DUPLICATE",
        reason: "Duplicate application_id detected. Only first submission processed.",
        priority: ACTION_PRIORITY["SKIP_DUPLICATE"],
        compensation_bid_usd_month: original.compensation_bid_usd_month,
        ct_overlap: original.ct_overlap,
      });
    }
  }

  // Sort by priority ascending (1 = most urgent)
  queue.sort((a, b) => a.priority - b.priority);

  return queue;
}
