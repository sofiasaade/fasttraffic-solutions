import {
  boolean,
  double,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Technician profile. Links a Manus user account (optional) to an Airtable
 * technician name so the mobile PWA can scope jobs to "me".
 */
export const technicians = mysqlTable("technicians", {
  id: int("id").autoincrement().primaryKey(),
  airtableName: varchar("airtableName", { length: 128 }).notNull().unique(),
  displayName: varchar("displayName", { length: 128 }).notNull(),
  userId: int("userId"),
  phone: varchar("phone", { length: 32 }),
  zones: text("zones"),
  experienceLevel: mysqlEnum("experienceLevel", [
    "apprentice",
    "junior",
    "senior",
  ])
    .default("junior")
    .notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Technician = typeof technicians.$inferSelect;
export type InsertTechnician = typeof technicians.$inferInsert;

/**
 * Per-technician professional profile: free-text experience summary and an
 * optional headline. Level lives on the `technicians` row (experienceLevel).
 * One row per technician (keyed by airtableName).
 */
export const technicianProfiles = mysqlTable("technician_profiles", {
  id: int("id").autoincrement().primaryKey(),
  airtableName: varchar("airtableName", { length: 128 }).notNull().unique(),
  headline: varchar("headline", { length: 255 }),
  experienceSummary: text("experienceSummary"),
  yearsExperience: int("yearsExperience"),
  updatedByUserId: int("updatedByUserId"),
  updatedByName: varchar("updatedByName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TechnicianProfile = typeof technicianProfiles.$inferSelect;
export type InsertTechnicianProfile = typeof technicianProfiles.$inferInsert;

/**
 * Safety-course / training certificates for a technician. The file bytes live
 * in S3; we store the storage key + url here plus metadata.
 */
export const technicianCertificates = mysqlTable("technician_certificates", {
  id: int("id").autoincrement().primaryKey(),
  airtableName: varchar("airtableName", { length: 128 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  issuer: varchar("issuer", { length: 255 }),
  /** Stored as YYYY-MM-DD. */
  issuedDate: varchar("issuedDate", { length: 10 }),
  /** Stored as YYYY-MM-DD; null = no expiry. */
  expiryDate: varchar("expiryDate", { length: 10 }),
  fileKey: varchar("fileKey", { length: 512 }),
  fileUrl: varchar("fileUrl", { length: 1024 }),
  fileName: varchar("fileName", { length: 255 }),
  mimeType: varchar("mimeType", { length: 128 }),
  uploadedByUserId: int("uploadedByUserId"),
  uploadedByName: varchar("uploadedByName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TechnicianCertificate = typeof technicianCertificates.$inferSelect;
export type InsertTechnicianCertificate =
  typeof technicianCertificates.$inferInsert;

/**
 * Technician availability overrides. Two kinds of rows:
 *  - kind="weekday": recurring weekly rule, weekday 0..6 (Sun..Sat), available bool
 *  - kind="date": a specific calendar date (YYYY-MM-DD), available bool
 * Absence of any rule = available by default. A date override beats a weekday rule.
 */
export const technicianAvailability = mysqlTable(
  "technician_availability",
  {
    id: int("id").autoincrement().primaryKey(),
    airtableName: varchar("airtableName", { length: 128 }).notNull(),
    kind: mysqlEnum("kind", ["weekday", "date"]).notNull(),
    /** 0..6 (Sun..Sat) when kind=weekday, else null. */
    weekday: int("weekday"),
    /** YYYY-MM-DD when kind=date, else null. */
    date: varchar("date", { length: 10 }),
    available: boolean("available").notNull(),
    reason: varchar("reason", { length: 255 }),
    updatedByName: varchar("updatedByName", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
);

export type TechnicianAvailability =
  typeof technicianAvailability.$inferSelect;
export type InsertTechnicianAvailability =
  typeof technicianAvailability.$inferInsert;

/**
 * Hazard assessments. A submitted assessment for a (jobId, technician, phase)
 * is the hard gate required before check-in.
 */
export const hazardAssessments = mysqlTable("hazard_assessments", {
  id: int("id").autoincrement().primaryKey(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  technicianName: varchar("technicianName", { length: 128 }).notNull(),
  phase: varchar("phase", { length: 32 }).notNull(),
  answers: text("answers").notNull(),
  hazardsIdentified: text("hazardsIdentified"),
  controlMeasures: text("controlMeasures"),
  ppeConfirmed: boolean("ppeConfirmed").default(false).notNull(),
  signature: varchar("signature", { length: 128 }),
  submittedAt: timestamp("submittedAt").defaultNow().notNull(),
});

export type HazardAssessment = typeof hazardAssessments.$inferSelect;
export type InsertHazardAssessment = typeof hazardAssessments.$inferInsert;

/**
 * Time logs: check-in / check-out per technician per job.
 * These feed directly into overtime calculations.
 */
export const timeLogs = mysqlTable("time_logs", {
  id: int("id").autoincrement().primaryKey(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  technicianName: varchar("technicianName", { length: 128 }).notNull(),
  phase: varchar("phase", { length: 32 }),
  checkInAt: timestamp("checkInAt"),
  checkOutAt: timestamp("checkOutAt"),
  hours: double("hours"),
  checkInLat: double("checkInLat"),
  checkInLon: double("checkInLon"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TimeLog = typeof timeLogs.$inferSelect;
export type InsertTimeLog = typeof timeLogs.$inferInsert;

/**
 * Immutable change-history log. Rows are append-only; never updated or deleted.
 */
export const changeHistory = mysqlTable("change_history", {
  id: int("id").autoincrement().primaryKey(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  actorUserId: int("actorUserId"),
  actorName: varchar("actorName", { length: 128 }),
  action: varchar("action", { length: 64 }).notNull(),
  fieldName: varchar("fieldName", { length: 128 }),
  oldValue: text("oldValue"),
  newValue: text("newValue"),
  details: text("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChangeHistory = typeof changeHistory.$inferSelect;
export type InsertChangeHistory = typeof changeHistory.$inferInsert;

/**
 * In-app notifications for technicians.
 */
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  technicianName: varchar("technicianName", { length: 128 }).notNull(),
  airtableJobId: varchar("airtableJobId", { length: 32 }),
  type: mysqlEnum("type", ["assigned", "modified", "cancelled", "info"]).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body"),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * App-level settings (e.g. overtime threshold).
 */
export const appSettings = mysqlTable("app_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = typeof appSettings.$inferInsert;

/**
 * Scheduler assignments: a technician scheduled to a job on a specific day
 * and time window, for a given phase. This powers the Assignar-style timeline.
 * Airtable phase fields stay the source of truth for "who is on the job";
 * this table adds the day + time detail the coordinator drops on the grid.
 */
export const schedulerAssignments = mysqlTable("scheduler_assignments", {
  id: int("id").autoincrement().primaryKey(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  technicianName: varchar("technicianName", { length: 128 }).notNull(),
  phase: varchar("phase", { length: 32 }).notNull(),
  /** Local date of the scheduled shift, stored as YYYY-MM-DD. */
  scheduledDate: varchar("scheduledDate", { length: 10 }).notNull(),
  /** Start/end clock time as HH:MM (24h), optional. */
  startTime: varchar("startTime", { length: 5 }),
  endTime: varchar("endTime", { length: 5 }),
  createdByUserId: int("createdByUserId"),
  createdByName: varchar("createdByName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SchedulerAssignment = typeof schedulerAssignments.$inferSelect;
export type InsertSchedulerAssignment =
  typeof schedulerAssignments.$inferInsert;


/**
 * Local job assignments: the authoritative record of which technicians are on a
 * job for a given phase. Airtable is read-only, so this table (not the Airtable
 * phase fields) is the source of truth for "who is assigned". One row per
 * (job, phase, technician).
 */
export const jobAssignments = mysqlTable("job_assignments", {
  id: int("id").autoincrement().primaryKey(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  phase: varchar("phase", { length: 32 }).notNull(),
  technicianName: varchar("technicianName", { length: 128 }).notNull(),
  // Optional day/time scheduling (local only). When set, the assignment is
  // pinned to a specific calendar day and time window in the Scheduler.
  scheduledDate: varchar("scheduledDate", { length: 10 }),
  startTime: varchar("startTime", { length: 5 }),
  endTime: varchar("endTime", { length: 5 }),
  // Confirmation workflow: assignments start as "tentative" (the coordinator is
  // still moving people around — NO technician alert is sent). Only when the
  // coordinator confirms does the technician get a single notification.
  status: varchar("status", { length: 16 }).default("tentative").notNull(),
  confirmedAt: timestamp("confirmedAt"),
  confirmedByName: varchar("confirmedByName", { length: 128 }),
  createdByUserId: int("createdByUserId"),
  createdByName: varchar("createdByName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type JobAssignment = typeof jobAssignments.$inferSelect;
export type InsertJobAssignment = typeof jobAssignments.$inferInsert;

/**
 * Local field photos. Bytes live in S3; this row stores the storage key + url
 * and metadata. Replaces writing attachments back to Airtable.
 */
export const jobPhotos = mysqlTable("job_photos", {
  id: int("id").autoincrement().primaryKey(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  technicianName: varchar("technicianName", { length: 128 }).notNull(),
  category: varchar("category", { length: 16 }).notNull(),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  storageUrl: varchar("storageUrl", { length: 1024 }).notNull(),
  filename: varchar("filename", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type JobPhoto = typeof jobPhotos.$inferSelect;
export type InsertJobPhoto = typeof jobPhotos.$inferInsert;

/**
 * Local field notes (timestamped). Replaces appending to the Airtable text field.
 */
export const jobNotes = mysqlTable("job_notes", {
  id: int("id").autoincrement().primaryKey(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  authorName: varchar("authorName", { length: 128 }).notNull(),
  authorRole: varchar("authorRole", { length: 32 }).notNull(),
  note: text("note").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type JobNote = typeof jobNotes.$inferSelect;
export type InsertJobNote = typeof jobNotes.$inferInsert;

/**
 * Billing notes ("Novedades"): coordinator-authored notes captured per job for
 * invoicing/accounting (e.g. extra signage, plan stamped, surcharges, scope
 * changes). Kept separate from field jobNotes. Airtable stays read-only.
 */
export const jobBillingNotes = mysqlTable("job_billing_notes", {
  id: int("id").autoincrement().primaryKey(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  note: text("note").notNull(),
  // Structured invoicing fields (all optional; the free note above is enough)
  extraSignage: text("extraSignage"),
  weekendSurcharge: boolean("weekendSurcharge").default(false).notNull(),
  holidaySurcharge: boolean("holidaySurcharge").default(false).notNull(),
  // "yes" | "no" | "unknown"
  planStamped: varchar("planStamped", { length: 16 }).default("unknown").notNull(),
  // Optional charge amount stored in cents to avoid float drift
  chargeAmountCents: int("chargeAmountCents"),
  chargeCategory: varchar("chargeCategory", { length: 64 }),
  authorName: varchar("authorName", { length: 128 }).notNull(),
  authorUserId: int("authorUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type JobBillingNote = typeof jobBillingNotes.$inferSelect;
export type InsertJobBillingNote = typeof jobBillingNotes.$inferInsert;

/**
 * Local job overrides: coordinator-applied changes (end date / sub-status) that
 * would otherwise be written to Airtable. One row per job; latest values win.
 */
export const jobOverrides = mysqlTable("job_overrides", {
  id: int("id").autoincrement().primaryKey(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull().unique(),
  endDate: varchar("endDate", { length: 32 }),
  subStatus: varchar("subStatus", { length: 128 }),
  updatedByUserId: int("updatedByUserId"),
  updatedByName: varchar("updatedByName", { length: 128 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type JobOverride = typeof jobOverrides.$inferSelect;
export type InsertJobOverride = typeof jobOverrides.$inferInsert;


/**
 * Equipment catalog: the list of draggable equipment items shown in the
 * Scheduler "Equipment" tab (e.g. No Parking signs, Barricades, Arrow Board,
 * Tables). Local-only; Airtable is read-only.
 */
export const equipmentCatalog = mysqlTable("equipment_catalog", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull().unique(),
  category: varchar("category", { length: 64 }),
  /** VIN / serial / unit identifier shown beside the name. */
  code: varchar("code", { length: 64 }),
  /** Hex color used for the chip in the timeline. */
  color: varchar("color", { length: 16 }),
  active: boolean("active").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EquipmentCatalogItem = typeof equipmentCatalog.$inferSelect;
export type InsertEquipmentCatalogItem = typeof equipmentCatalog.$inferInsert;

/**
 * Equipment assignments: a piece of equipment scheduled to a job on a specific
 * day, optionally with a technician responsible for installing it (e.g. placing
 * the No Parking signs the day before). Local-only.
 */
export const equipmentAssignments = mysqlTable("equipment_assignments", {
  id: int("id").autoincrement().primaryKey(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  equipmentName: varchar("equipmentName", { length: 128 }).notNull(),
  /** Local date of the equipment placement, stored as YYYY-MM-DD. */
  scheduledDate: varchar("scheduledDate", { length: 10 }).notNull(),
  /** Start/end clock time as HH:MM (24h), optional (used by the Day Timeline). */
  startTime: varchar("startTime", { length: 5 }),
  endTime: varchar("endTime", { length: 5 }),
  /** Optional technician responsible for installing/placing the equipment. */
  technicianName: varchar("technicianName", { length: 128 }),
  quantity: int("quantity").default(1).notNull(),
  notes: text("notes"),
  createdByUserId: int("createdByUserId"),
  createdByName: varchar("createdByName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EquipmentAssignment = typeof equipmentAssignments.$inferSelect;
export type InsertEquipmentAssignment =
  typeof equipmentAssignments.$inferInsert;


/**
 * Truck catalog: the fleet of trucks/vehicles a worker can be assigned to drive
 * on a given day. Local-only; Airtable is read-only.
 */
export const truckCatalog = mysqlTable("truck_catalog", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull().unique(),
  /** Internal fleet code (e.g. FTS-01-0004). */
  code: varchar("code", { length: 32 }),
  /** Short reference / unit number (e.g. F 14). */
  ref: varchar("ref", { length: 32 }),
  /** Full name/brand/model description. */
  description: varchar("description", { length: 255 }),
  /** Vehicle Identification Number. */
  vin: varchar("vin", { length: 32 }),
  /** Optional license plate / unit number. */
  plate: varchar("plate", { length: 32 }),
  /** Hex color used for the chip in the timeline. */
  color: varchar("color", { length: 16 }),
  active: boolean("active").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TruckCatalogItem = typeof truckCatalog.$inferSelect;
export type InsertTruckCatalogItem = typeof truckCatalog.$inferInsert;

/**
 * Truck assignments: a truck scheduled to a job on a specific day, optionally
 * with the worker (driver) who will drive it that day. Local-only.
 */
export const truckAssignments = mysqlTable("truck_assignments", {
  id: int("id").autoincrement().primaryKey(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  truckName: varchar("truckName", { length: 128 }).notNull(),
  /** Local date of the truck assignment, stored as YYYY-MM-DD. */
  scheduledDate: varchar("scheduledDate", { length: 10 }).notNull(),
  /** Start/end clock time as HH:MM (24h), optional (used by the Day Timeline). */
  startTime: varchar("startTime", { length: 5 }),
  endTime: varchar("endTime", { length: 5 }),
  /** Optional driver (worker) for the truck that day. */
  driverName: varchar("driverName", { length: 128 }),
  notes: text("notes"),
  createdByUserId: int("createdByUserId"),
  createdByName: varchar("createdByName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TruckAssignment = typeof truckAssignments.$inferSelect;
export type InsertTruckAssignment = typeof truckAssignments.$inferInsert;

/**
 * Daily job snapshots for change detection. Each row is one job captured on a
 * given snapshot date (UTC YYYY-MM-DD) while it sits inside the 5-day planning
 * window. Diffing today's snapshot against the most recent prior snapshot per
 * job surfaces New / Cancelled / Postponed / Modified changes. Airtable stays
 * read-only; these snapshots are local.
 */
export const jobSnapshots = mysqlTable("job_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  /** Snapshot date, UTC YYYY-MM-DD. */
  snapshotDate: varchar("snapshotDate", { length: 10 }).notNull(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  requestId: varchar("requestId", { length: 64 }),
  company: varchar("company", { length: 255 }),
  jobAddress: varchar("jobAddress", { length: 512 }),
  startDate: varchar("startDate", { length: 32 }),
  endDate: varchar("endDate", { length: 32 }),
  status: varchar("status", { length: 64 }),
  subStatus: varchar("subStatus", { length: 128 }),
  setupDuration: varchar("setupDuration", { length: 128 }),
  closureType: varchar("closureType", { length: 512 }),
  impact: varchar("impact", { length: 64 }),
  technicians: text("technicians"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type JobSnapshot = typeof jobSnapshots.$inferSelect;
export type InsertJobSnapshot = typeof jobSnapshots.$inferInsert;

/**
 * Detected job changes (append-only). One row per detected change of a job
 * between two consecutive snapshots. changeType is the high-level category;
 * fieldName/oldValue/newValue carry the detail for "modified" changes.
 */
export const jobChanges = mysqlTable("job_changes", {
  id: int("id").autoincrement().primaryKey(),
  /** Snapshot date this change was detected on, UTC YYYY-MM-DD. */
  detectedDate: varchar("detectedDate", { length: 10 }).notNull(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  requestId: varchar("requestId", { length: 64 }),
  company: varchar("company", { length: 255 }),
  /** new | cancelled | postponed | modified */
  changeType: mysqlEnum("changeType", [
    "new",
    "cancelled",
    "postponed",
    "modified",
  ]).notNull(),
  /** For modified: which field changed (e.g. jobAddress, closureType). */
  fieldName: varchar("fieldName", { length: 64 }),
  oldValue: text("oldValue"),
  newValue: text("newValue"),
  /** The job's startDate at detection time, for the 5-day window display. */
  startDate: varchar("startDate", { length: 32 }),
  /** Coordinator can acknowledge/dismiss a change from the alerts tray. */
  acknowledgedAt: timestamp("acknowledgedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type JobChange = typeof jobChanges.$inferSelect;
export type InsertJobChange = typeof jobChanges.$inferInsert;


/**
 * Flagging hours: billable two-way / manual traffic-control ("flagging") hours
 * logged per person, per day, per job. Flagging is billed PER PERSON-HOUR, so
 * each flagger on a job/day gets its own row (e.g. 3 flaggers x 5h = 3 rows of
 * 5h = 15 billable hours). This is independent of setup/pickup labour and feeds
 * the billing summary. Airtable stays read-only; this is the source of truth.
 */
export const flaggingHours = mysqlTable("flagging_hours", {
  id: int("id").autoincrement().primaryKey(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  technicianName: varchar("technicianName", { length: 128 }).notNull(),
  /** Local date of the flagging shift, stored as YYYY-MM-DD. */
  workDate: varchar("workDate", { length: 10 }).notNull(),
  /** Billable flagging hours for this person on this day (e.g. 5.5). */
  hours: double("hours").notNull(),
  /** Optional billing rate snapshot, in cents per hour (e.g. 8500 = $85.00/h). */
  hourlyRateCents: int("hourlyRateCents"),
  note: text("note"),
  createdByUserId: int("createdByUserId"),
  createdByName: varchar("createdByName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FlaggingHours = typeof flaggingHours.$inferSelect;
export type InsertFlaggingHours = typeof flaggingHours.$inferInsert;


/**
 * Cache of Street Use Permit (SU) schedule data extracted from the permit PDF
 * via the LLM. Keyed by (airtableJobId + filename) so we never re-analyze the
 * same PDF. Stores the parsed valid-from / valid-to schedule that powers the
 * Day Timeline summary boxes (before/at/after 9AM, finished/picked up).
 */
export const permitExtractions = mysqlTable("permit_extractions", {
  id: int("id").autoincrement().primaryKey(),
  airtableJobId: varchar("airtableJobId", { length: 32 }).notNull(),
  /** The SU attachment filename this extraction came from. */
  filename: varchar("filename", { length: 512 }).notNull(),
  /** The attachment URL at extraction time (for reference / re-fetch). */
  fileUrl: text("fileUrl"),
  /** Permit number parsed from the PDF, e.g. SU-26-672264. */
  permitNumber: varchar("permitNumber", { length: 64 }),
  /** Permit Valid From — date (YYYY-MM-DD), time (HH:MM 24h), day of week. */
  validFromDate: varchar("validFromDate", { length: 10 }),
  validFromTime: varchar("validFromTime", { length: 5 }),
  validFromDay: varchar("validFromDay", { length: 16 }),
  /** Permit Valid To — date (YYYY-MM-DD), time (HH:MM 24h), day of week. */
  validToDate: varchar("validToDate", { length: 10 }),
  validToTime: varchar("validToTime", { length: 5 }),
  validToDay: varchar("validToDay", { length: 16 }),
  /** Number Of Days parsed from the permit, if present. */
  numberOfDays: int("numberOfDays"),
  /** "ok" when parsed successfully, "error" when the LLM could not parse. */
  parseStatus: varchar("parseStatus", { length: 16 }).notNull().default("ok"),
  rawJson: text("rawJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PermitExtraction = typeof permitExtractions.$inferSelect;
export type InsertPermitExtraction = typeof permitExtractions.$inferInsert;
