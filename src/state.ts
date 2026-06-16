import * as fs from "fs";
import * as path from "path";
import type { PersistedState, ActionType } from "./types.js";

const STATE_FILE = path.resolve(process.cwd(), "state.json");

export function loadState(): PersistedState {
  if (!fs.existsSync(STATE_FILE)) {
    return { last_run_at: "", processed: {} };
  }
  const raw = fs.readFileSync(STATE_FILE, "utf-8");
  return JSON.parse(raw) as PersistedState;
}

export function saveState(state: PersistedState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function recordAction(
  state: PersistedState,
  applicationId: string,
  action: ActionType
): PersistedState {
  return {
    ...state,
    last_run_at: new Date().toISOString(),
    processed: {
      ...state.processed,
      [applicationId]: {
        action,
        actioned_at: new Date().toISOString(),
      },
    },
  };
}

export function wasProcessed(state: PersistedState, applicationId: string): boolean {
  return applicationId in state.processed;
}
