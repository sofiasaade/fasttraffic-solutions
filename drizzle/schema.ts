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
  experienceLevel: mysqlEnum("experienceLevel", ["junior", "senior"])
    .default("junior")
    .notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Technician = typeof technicians.$inferSelect;
export type InsertTechnician = typeof technicians.$inferInsert;

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
  /** Optional driver (worker) for the truck that day. */
  driverName: varchar("driverName", { length: 128 }),
  notes: text("notes"),
  createdByUserId: int("createdByUserId"),
  createdByName: varchar("createdByName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TruckAssignment = typeof truckAssignments.$inferSelect;
export type InsertTruckAssignment = typeof truckAssignments.$inferInsert;
