export interface Application {
  application_id: string;
  candidate_name: string;
  school: string;
  program: string;
  submitted_at: string;
  artifact_url: string;
  technical_evidence: string;
  compensation_bid_usd_month: number;
  ct_overlap: string;
}

export interface CandidateEvent {
  event_id: string;
  application_id: string;
  type: string;
  occurred_at: string;
  channel: string;
  evidence: string;
}

export interface SchoolRoute {
  source_lane_id: string;
  source_type: string;
  institution: string;
  route: string;
  contact: string;
  portal_required: boolean;
  cost_blocker: boolean;
  last_contact_at: string;
  status: string;
}

export type ActionType =
  | "SEND_TECHNICAL_SCREEN"
  | "REQUEST_EVIDENCE"
  | "REQUEST_COMP_BID"
  | "FLAG_BOUNCED_ROUTE"
  | "MARK_STALE"
  | "ALREADY_SCREENED"
  | "SKIP_DUPLICATE";

export interface QueueItem {
  application_id: string;
  candidate_name: string;
  school: string;
  action: ActionType;
  reason: string;
  priority: number;
  compensation_bid_usd_month: number;
  ct_overlap: string;
}

export interface PersistedState {
  last_run_at: string;
  processed: Record<string, { action: ActionType; actioned_at: string }>;
}
