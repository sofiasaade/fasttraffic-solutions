// Exact Airtable field names for the "Approved Jobs" table.
// Airtable is the authoritative data source — these strings MUST match exactly.

export const AF = {
  company: "Company",
  jobAddress: "Job Address",
  projectTitle: "Project Title / Email Reference",
  startDate: "Start Date",
  endDate: "End Date",
  setupDuration: "Setup Duration",
  status: "Status",
  subStatus: "Sub-Status Field Operations",
  requestId: "Request ID",
  techPrep: "Traffic Technician Preparation",
  techSetup: "Traffic Technician Setup",
  techPickup: "Traffic Technician Pickup",
  planFile: "Plan File",
  fieldPhotos: "Field Photos",
  fieldComments: "Field Commnets", // note: actual Airtable field is misspelled this way
  notes: "Notes",
  lat: "Lat",
  lon: "Lon",
  municipality: "Municipality",
  siteContactPhone: "Site Contact Phone Number",
  requestorName: "Requestor Name",
  requestorPhone: "Requestor Phone Number",
} as const;

// Statuses that appear on the Coordinator Dispatch Board
export const DISPATCH_STATUSES = ["Field", "Permit Approved"] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

// Sub-status options (from Airtable "Sub-Status Field Operations")
export const SUB_STATUS_OPTIONS = [
  "TMP Creation",
  "Permit Request Submitted(Field)",
  "Permit Request (Set-Up Prepare)",
  "Permit Approved(Field)",
  "Only Parking Signs Prepared (Field)",
  "Setup Prepared - Signs Missing (Field)",
  "Setup Prepared (Field) ",
  "Daily Setup (Field)",
  "24 Hours Setup (Field)",
  "Setup - Cancelled (Field)",
  "Setup - Postponed (Field)",
  "Setup - On Hold (Field)",
  "Picked up",
  "Cancelled (Field)",
  "Declined (Field)",
] as const;

// Setup duration options (from Airtable "Setup Duration")
export const SETUP_DURATION_OPTIONS = [
  "24 Hours Set Up",
  "Daily Set Up (9:00 AM - 3:00) (Several Days)",
  "Daytime Work (9:00 AM - 3:00 PM)",
  "Daytime Work (7:00 AM - 5:00 PM)",
  "Daytime Work (8:00 AM - 5:00 PM)",
  "Nightime Work (9:00 PM - 5:00 AM)",
  "Nightime Work (6:00 PM - 5:00 AM)",
  "Nightly Set Up (9:00 PM - 5:00 AM) (Several Nights)",
] as const;

// The canonical roster of technicians (union of all three phase fields).
export const TECHNICIANS = [
  "Juan Camilo Monroy",
  "Hector Chaparro",
  "Hugo Lopez",
  "Ryley Brisbois",
  "Alejandro Galindez",
  "Camilo Galindez",
  "Salvador Galindez",
  "Julian Montoya",
  "Wilmar Cepeda",
  "Zion Holiday",
  "Juanito",
  "Jose Galindez",
  "Adrian ", // note: Airtable stores this with a trailing space
] as const;

export type TechnicianName = (typeof TECHNICIANS)[number];

export type JobPhase = "Preparation" | "Setup" | "Pickup";

export const PHASE_TO_FIELD: Record<JobPhase, string> = {
  Preparation: AF.techPrep,
  Setup: AF.techSetup,
  Pickup: AF.techPickup,
};

// Alberta overtime threshold (hours per pay period). Configurable, defaulted to 44.
export const ALBERTA_OT_THRESHOLD_DEFAULT = 44;

export interface AirtableAttachment {
  id?: string;
  url: string;
  filename?: string;
  type?: string;
  thumbnails?: { large?: { url: string }; small?: { url: string } };
}

export interface JobRecord {
  id: string;
  company: string | null;
  jobAddress: string | null;
  projectTitle: string | null;
  startDate: string | null; // ISO
  endDate: string | null; // ISO
  setupDuration: string | null;
  status: string | null;
  subStatus: string | null;
  requestId: string | null;
  municipality: string | null;
  lat: number | null;
  lon: number | null;
  siteContactPhone: string | null;
  requestorName: string | null;
  techPrep: string[];
  techSetup: string[];
  techPickup: string[];
  planFile: AirtableAttachment[];
  fieldPhotos: AirtableAttachment[];
  fieldComments: string | null;
}

// Hazard Assessment checklist items (traffic control field work).
// Each must be acknowledged before check-in is permitted.
export const HAZARD_CHECKLIST: { key: string; label: string }[] = [
  { key: "traffic_volume", label: "Reviewed traffic volume and speed at the site" },
  { key: "work_zone_layout", label: "Confirmed work zone layout matches the approved plan" },
  { key: "signage_devices", label: "Signs, cones, and devices inspected and serviceable" },
  { key: "weather", label: "Checked weather / visibility conditions" },
  { key: "public_pedestrians", label: "Identified pedestrian and public exposure" },
  { key: "overhead_underground", label: "Checked for overhead lines / underground hazards" },
  { key: "emergency_access", label: "Emergency access route is clear" },
  { key: "communication", label: "Communication plan with crew confirmed" },
];
