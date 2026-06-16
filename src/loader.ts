import * as fs from "fs";
import * as path from "path";
import type { Application, CandidateEvent, SchoolRoute } from "./types.js";

const DATA_DIR = path.resolve(process.cwd(), "data");

export function loadApplications(): Application[] {
  const raw = fs.readFileSync(path.join(DATA_DIR, "applications.json"), "utf-8");
  return JSON.parse(raw) as Application[];
}

export function loadEvents(): CandidateEvent[] {
  const raw = fs.readFileSync(path.join(DATA_DIR, "events.json"), "utf-8");
  return JSON.parse(raw) as CandidateEvent[];
}

export function loadSchoolRoutes(): SchoolRoute[] {
  const raw = fs.readFileSync(path.join(DATA_DIR, "school_routes.json"), "utf-8");
  return JSON.parse(raw) as SchoolRoute[];
}
