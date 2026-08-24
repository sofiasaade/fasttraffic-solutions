/**
 * FTS controlled safety documents — registry and Phase-1 form definitions.
 *
 * Every submission stores the form number + version + effective date it was
 * completed against; publishing a new version NEVER alters old records (the
 * submission keeps a full historical copy of its answers).
 *
 * Sources of truth: the controlled Word/PDF forms provided by FTS
 * (FTS-HZ-001A..F V2, FTS-HZ-002 V2, FTS-HZ-006 V2, effective 2026-08-21) and
 * the app-internal daily-workflow forms (FTS-APP-*).
 */

export interface ControlledForm {
  formNumber: string;
  version: string;
  title: string;
  effectiveDate: string; // YYYY-MM-DD
  /** ACSA COR elements this form evidences. */
  corElements: number[];
  /** Which work types auto-assign this form (Phase 3+). */
  workTypes?: string[];
}

/** Master register of controlled documents the app knows about. */
export const CONTROLLED_FORMS: ControlledForm[] = [
  { formNumber: "FTS-HZ-001A", version: "V2", title: "Site-Specific Hazard Assessment — Full Road Closure", effectiveDate: "2026-08-21", corElements: [5, 6], workTypes: ["full_road_closure"] },
  { formNumber: "FTS-HZ-001B", version: "V2", title: "Site-Specific Hazard Assessment — Lane Closure", effectiveDate: "2026-08-21", corElements: [5, 6], workTypes: ["lane_closure"] },
  { formNumber: "FTS-HZ-001C", version: "V2", title: "Site-Specific Hazard Assessment — Alternating Two-Way Traffic", effectiveDate: "2026-08-21", corElements: [5, 6], workTypes: ["alternating"] },
  { formNumber: "FTS-HZ-001D", version: "V2", title: "Site-Specific Hazard Assessment — Traffic Flagger", effectiveDate: "2026-08-21", corElements: [5, 6], workTypes: ["flagging"] },
  { formNumber: "FTS-HZ-001E", version: "V2", title: "Site-Specific Hazard Assessment — Prep and Pick-up", effectiveDate: "2026-08-21", corElements: [5, 6], workTypes: ["prep_pickup"] },
  { formNumber: "FTS-HZ-001F", version: "V2", title: "Site-Specific Hazard Assessment — Warehouse Operations", effectiveDate: "2026-08-21", corElements: [5, 6], workTypes: ["warehouse"] },
  { formNumber: "FTS-HZ-002", version: "V2", title: "Daily Site Safety and Traffic Control Checklist", effectiveDate: "2026-08-21", corElements: [5, 6, 7] },
  { formNumber: "FTS-HZ-006", version: "V2", title: "Site-Specific Emergency Response Plan", effectiveDate: "2026-08-21", corElements: [8] },
  // App-internal daily workflow forms (Safety Coordinator controls versions).
  { formNumber: "FTS-APP-SOD", version: "V1", title: "Start-of-Day Confirmation", effectiveDate: "2026-08-24", corElements: [4] },
  { formNumber: "FTS-APP-VEH", version: "V1", title: "Vehicle & Equipment Pre-Use Inspection", effectiveDate: "2026-08-24", corElements: [7] },
];

export function activeForm(formNumber: string): ControlledForm | undefined {
  return CONTROLLED_FORMS.find((f) => f.formNumber === formNumber);
}

/* ---------------------- Start-of-Day Confirmation ---------------------- */

export const FITNESS_OPTIONS = [
  { key: "fit", label: "Fit for assigned duties" },
  { key: "speak_supervisor", label: "Need to speak privately with supervisor" },
  { key: "restriction_reported", label: "Restriction already reported" },
  { key: "not_fit", label: "Not fit for assigned duties" },
] as const;

export const PPE_ITEMS = [
  { key: "hi_vis", label: "High-visibility apparel", required: true },
  { key: "footwear", label: "CSA safety footwear", required: true },
  { key: "hard_hat", label: "Hard hat", required: true },
  { key: "glasses", label: "Safety glasses", required: true },
  { key: "gloves", label: "Work gloves", required: true },
  { key: "hearing", label: "Hearing protection", required: false },
  { key: "weather", label: "Weather protection", required: false },
  { key: "sun", label: "Sun protection", required: false },
  { key: "respiratory", label: "Respiratory protection (when assigned)", required: false },
] as const;

export const PPE_STATES = [
  "available",
  "missing",
  "damaged",
  "replacement_requested",
  "na",
] as const;
export type PpeState = (typeof PPE_STATES)[number];

export const COMMS_ITEMS = [
  { key: "assignment", label: "Assignment reviewed" },
  { key: "location", label: "Project location reviewed" },
  { key: "activity", label: "Expected activity reviewed" },
  { key: "weather", label: "Weather reviewed" },
  { key: "client_instructions", label: "Special client instructions reviewed" },
  { key: "emergency_comms", label: "Emergency communication method confirmed" },
] as const;

/* ------------------- Vehicle & Equipment Pre-Use Inspection ------------------- */

export const INSPECTION_RESPONSES = ["pass", "defect", "na", "not_inspected"] as const;
export type InspectionResponse = (typeof INSPECTION_RESPONSES)[number];

export interface InspectionItem {
  key: string;
  label: string;
  /** Required items cannot be satisfied by "not inspected". */
  required: boolean;
}

export const VEHICLE_INSPECTION_SECTIONS: {
  key: string;
  title: string;
  items: InspectionItem[];
}[] = [
  {
    key: "exterior",
    title: "Vehicle exterior",
    items: [
      { key: "tires", label: "Tires and wheels", required: true },
      { key: "lights", label: "Lights", required: true },
      { key: "signals", label: "Turn signals", required: true },
      { key: "brake_lights", label: "Brake lights", required: true },
      { key: "mirrors", label: "Mirrors", required: true },
      { key: "windshield", label: "Windshield", required: true },
      { key: "windows", label: "Windows", required: false },
      { key: "wipers", label: "Wipers and washer fluid", required: true },
      { key: "body", label: "Body damage", required: false },
      { key: "plate", label: "Licence plate", required: true },
      { key: "leaks", label: "Fluid leaks", required: true },
    ],
  },
  {
    key: "operation",
    title: "Vehicle operation",
    items: [
      { key: "brakes", label: "Brakes", required: true },
      { key: "steering", label: "Steering", required: true },
      { key: "horn", label: "Horn", required: true },
      { key: "seatbelts", label: "Seat belts", required: true },
      { key: "warnings", label: "Warning indicators", required: true },
      { key: "backup", label: "Backup alarm / camera (when equipped)", required: false },
      { key: "parking_brake", label: "Parking brake", required: true },
    ],
  },
  {
    key: "safety",
    title: "Safety equipment",
    items: [
      { key: "first_aid", label: "First-aid kit", required: true },
      { key: "extinguisher", label: "Fire extinguisher", required: true },
      { key: "warning_devices", label: "Emergency warning devices", required: true },
      { key: "flashlight", label: "Flashlight", required: false },
      { key: "comms", label: "Communication equipment", required: true },
      { key: "spill_kit", label: "Spill kit (when required)", required: false },
      { key: "documents", label: "Required vehicle documents", required: true },
    ],
  },
  {
    key: "traffic",
    title: "Traffic-control equipment",
    items: [
      { key: "signs", label: "Signs", required: false },
      { key: "stands", label: "Sign stands", required: false },
      { key: "cones", label: "Cones", required: false },
      { key: "delineators", label: "Delineators", required: false },
      { key: "barricades", label: "Barricades", required: false },
      { key: "ballast", label: "Sandbags / weights", required: false },
      { key: "arrow_board", label: "Arrow board", required: false },
      { key: "message_board", label: "Message board", required: false },
      { key: "radios", label: "Radios", required: false },
      { key: "paddles", label: "Stop/Slow paddles", required: false },
      { key: "lighting", label: "Work-zone lighting", required: false },
      { key: "batteries", label: "Batteries and chargers", required: false },
      { key: "ppe_stock", label: "PPE", required: false },
      { key: "other", label: "Other assigned equipment", required: false },
    ],
  },
];

export const DEFECT_SEVERITIES = ["minor", "major", "critical"] as const;
export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

/* ---------------------------- Daily stages ---------------------------- */

export const DAY_STAGES = [
  { key: "start", label: "Start day" },
  { key: "sod", label: "Start-of-day confirmation" },
  { key: "vehicle", label: "Vehicle inspection" },
  { key: "depart", label: "Depart warehouse" },
  { key: "arrive", label: "Arrive at site" },
  { key: "return", label: "Return to warehouse" },
  { key: "end", label: "End day" },
] as const;
