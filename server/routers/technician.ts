import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { fetchJobById } from "../airtable";
import { JobRecord } from "../../shared/airtableFields";
import {
  INTERNAL_ACTIVITIES,
  isInternalJobId,
  internalLabel,
} from "../../shared/internalTasks";
import { deriveZone, getPayPeriodFor } from "../../shared/opsLogic";
import { storageGetSignedUrl, storagePut } from "../storage";
import {
  appendChangeHistory,
  closeTimeLog,
  countUnreadNotifications,
  createHazardAssessment,
  createJobNote,
  createJobPhoto,
  createTimeLog,
  endDaySession,
  getDaySession,
  getHazardAssessment,
  getJobOverride,
  getOpenTimeLog,
  getOvertimeThreshold,
  getTechnicianByName,
  hazardJobIdsForDay,
  listConfirmedAssignmentRows,
  listTruckCatalog,
  setAssignmentCompleted,
  startDaySession,
  getTechnicianByUserId,
  linkTechnicianToUser,
  listJobIdsForTechnician,
  listJobNotes,
  listJobPhotos,
  listNotificationsForTechnician,
  listTechnicians,
  listTimeLogsForTechnician,
  markAllNotificationsRead,
  markNotificationRead,
  seedTechnicians,
} from "../opsDb";

const phaseSchema = z.enum(["Preparation", "Setup", "Pickup"]);

/** Local YYYY-MM-DD (no timezone drift). */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function resolveTechnician(userId: number) {
  return getTechnicianByUserId(userId);
}

// Build the merged job shape the mobile UI expects: local assignments drive
// phases, local override applies end date / sub-status, and local photos/notes
// are surfaced as fieldPhotos / fieldComments. Airtable stays read-only.
async function buildMyJob(job: JobRecord, _technicianName: string, phases: string[]) {
  const [override, photos, notes] = await Promise.all([
    getJobOverride(job.id),
    listJobPhotos(job.id),
    listJobNotes(job.id),
  ]);

  const fieldPhotos = await Promise.all(
    photos.map(async (p) => {
      let url = p.storageUrl;
      try {
        url = await storageGetSignedUrl(p.storageKey);
      } catch {
        // fall back to stored url
      }
      return {
        id: String(p.id),
        url,
        filename: p.filename ?? `${p.category}.jpg`,
        thumbnails: { large: { url }, small: { url } },
      };
    }),
  );

  const fieldComments =
    notes.length > 0
      ? notes
          .slice()
          .reverse()
          .map((n) => {
            const stamp = new Date(n.createdAt).toLocaleString("en-CA", {
              timeZone: "America/Edmonton",
            });
            return `[${stamp}] ${n.authorName}: ${n.note}`;
          })
          .join("\n")
      : null;

  const merged: JobRecord = {
    ...job,
    endDate: override?.endDate ?? job.endDate,
    subStatus: override?.subStatus ?? job.subStatus,
    fieldPhotos,
    fieldComments,
  };

  return { ...merged, zone: deriveZone(merged as any), myPhases: phases };
}

export const technicianRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    const tech = await resolveTechnician(ctx.user.id);
    return tech ?? null;
  }),

  // A technician's OWN hours: current pay period regular vs overtime, plus a
  // list of recent time-log entries. Read-only; reuses the same pay-period and
  // overtime-threshold rules the coordinator Overtime page uses, so the numbers
  // agree. Only ever returns the signed-in technician's own logs.
  myHours: protectedProcedure
    .input(z.object({ date: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const tech = await resolveTechnician(ctx.user.id);
      if (!tech) return null;
      const ref = input?.date ? new Date(input.date) : new Date();
      const period = getPayPeriodFor(ref);
      const threshold = await getOvertimeThreshold();

      const logs = await listTimeLogsForTechnician(tech.airtableName);
      const inPeriod = logs.filter((l) => {
        const t = l.checkInAt ? new Date(l.checkInAt).getTime() : 0;
        return t >= period.start.getTime() && t < period.end.getTime();
      });
      const periodHours = inPeriod.reduce((n, l) => n + (l.hours ?? 0), 0);
      // WEEKLY overtime rule: 44 regular hours per week, resetting each week.
      const weekMs = 7 * 24 * 3600 * 1000;
      let w1 = 0;
      let w2 = 0;
      for (const l of inPeriod) {
        const t = new Date(l.checkInAt!).getTime();
        if (t - period.start.getTime() < weekMs) w1 += l.hours ?? 0;
        else w2 += l.hours ?? 0;
      }
      const regular = Math.min(w1, threshold) + Math.min(w2, threshold);
      const overtime =
        Math.max(0, w1 - threshold) + Math.max(0, w2 - threshold);

      return {
        technicianName: tech.displayName ?? tech.airtableName,
        period: {
          start: period.start.toISOString(),
          end: period.end.toISOString(),
        },
        threshold,
        totalHours: periodHours,
        regularHours: regular,
        overtimeHours: overtime,
        openLog: logs.find((l) => l.checkInAt && !l.checkOutAt) ?? null,
        recent: logs.slice(0, 20).map((l) => ({
          id: l.id,
          airtableJobId: l.airtableJobId,
          phase: l.phase,
          checkInAt: l.checkInAt ? new Date(l.checkInAt).toISOString() : null,
          checkOutAt: l.checkOutAt ? new Date(l.checkOutAt).toISOString() : null,
          hours: l.hours ?? null,
        })),
      };
    }),

  roster: protectedProcedure.query(async () => {
    await seedTechnicians();
    return listTechnicians();
  }),

  claimIdentity: protectedProcedure
    .input(z.object({ airtableName: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tech = await getTechnicianByName(input.airtableName);
      if (!tech)
        throw new TRPCError({ code: "NOT_FOUND", message: "Technician not found" });
      await linkTechnicianToUser(input.airtableName, ctx.user.id);
      return { ok: true as const };
    }),

  // Jobs assigned to me — sourced from LOCAL assignments, enriched from Airtable.
  myJobs: protectedProcedure.query(async ({ ctx }) => {
    const tech = await resolveTechnician(ctx.user.id);
    if (!tech) return [];

    const byJob = await listJobIdsForTechnician(tech.airtableName);
    const jobIds = Array.from(byJob.keys());
    if (jobIds.length === 0) return [];

    // Assignment metadata (scheduled time, coordinator note, completion) and
    // whether TODAY's hazard assessment is already submitted per job.
    const today = localDayKey(new Date());
    const [rows, hazardsDone] = await Promise.all([
      listConfirmedAssignmentRows(tech.airtableName),
      hazardJobIdsForDay(tech.airtableName, today),
    ]);

    const results = [];
    for (const jobId of jobIds) {
      // Internal (non-project) activities have no Airtable record — build a
      // synthetic job so the tech sees the task like any other assignment.
      if (isInternalJobId(jobId)) {
        const mine = rows.filter((r) => r.airtableJobId === jobId);
        const days = mine
          .map((r) => r.scheduledDate)
          .filter((d): d is string => !!d)
          .sort();
        const timed =
          mine.find((r) => r.scheduledDate === today && r.startTime) ??
          mine.find((r) => r.startTime) ??
          null;
        const noted = mine.find((r) => r.note) ?? null;
        const synthetic: JobRecord = {
          id: jobId,
          company: "Fast Traffic — Internal",
          jobAddress: internalLabel(jobId),
          projectTitle: internalLabel(jobId),
          startDate: days[0] ?? today,
          endDate: days[days.length - 1] ?? days[0] ?? today,
          setupDuration: null,
          status: "CONFIRMED",
          subStatus: null,
          requestId: null,
          municipality: null,
          lat: null,
          lon: null,
          siteContactPhone: null,
          requestorName: null,
          techPrep: [],
          techSetup: [],
          techPickup: [],
          planFile: [],
          fieldPhotos: [],
          fieldComments: null,
          closureType: null,
          impact: null,
          calendarInfo: null,
          emoji:
            INTERNAL_ACTIVITIES.find((a) => a.id === jobId)?.emoji ?? "🔧",
          clientMessage: null,
          signsCount: null,
        };
        results.push({
          ...(await buildMyJob(synthetic, tech.airtableName, byJob.get(jobId) ?? [])),
          assignedStartTime: timed?.startTime ?? null,
          assignedEndTime: timed?.endTime ?? null,
          coordinatorNote: noted?.note ?? null,
          completedAt: mine.find((r) => r.completedAt)?.completedAt ?? null,
          hazardDoneToday: hazardsDone.has(jobId),
        });
        continue;
      }
      try {
        const job = await fetchJobById(jobId);
        const phases = byJob.get(jobId) ?? [];
        const mine = rows.filter((r) => r.airtableJobId === jobId);
        // Prefer TODAY's day-pinned row for the displayed time — a tech doing
        // several jobs a day is ordered by the hour each one happens.
        const timed =
          mine.find((r) => r.scheduledDate === today && r.startTime) ??
          mine.find((r) => r.startTime) ??
          null;
        const noted = mine.find((r) => r.note) ?? null;
        results.push({
          ...(await buildMyJob(job, tech.airtableName, phases)),
          assignedStartTime: timed?.startTime ?? null,
          assignedEndTime: timed?.endTime ?? null,
          coordinatorNote: noted?.note ?? null,
          completedAt: mine.find((r) => r.completedAt)?.completedAt ?? null,
          hazardDoneToday: hazardsDone.has(jobId),
        });
      } catch {
        // Skip jobs that can't be fetched from Airtable.
      }
    }
    // Order the technician's schedule by assigned start time (jobs without a
    // time go last, then by start date).
    results.sort((a: any, b: any) => {
      const ta = a.assignedStartTime ?? "99:99";
      const tb = b.assignedStartTime ?? "99:99";
      if (ta !== tb) return ta.localeCompare(tb);
      return (a.startDate ?? "").localeCompare(b.startDate ?? "");
    });
    return results;
  }),

  jobStatus: protectedProcedure
    .input(z.object({ jobId: z.string(), phase: phaseSchema }))
    .query(async ({ ctx, input }) => {
      const tech = await resolveTechnician(ctx.user.id);
      if (!tech)
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a technician" });
      const hazard = await getHazardAssessment(
        input.jobId,
        tech.airtableName,
        input.phase,
      );
      const openLog = await getOpenTimeLog(input.jobId, tech.airtableName);
      return {
        hazardSubmitted: !!hazard,
        hazard: hazard ?? null,
        checkedIn: !!openLog,
        openLog: openLog ?? null,
      };
    }),

  submitHazard: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        phase: phaseSchema,
        answers: z.record(z.string(), z.boolean()),
        hazardsIdentified: z.string().optional(),
        controlMeasures: z.string().optional(),
        ppeConfirmed: z.boolean(),
        signature: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tech = await resolveTechnician(ctx.user.id);
      if (!tech)
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a technician" });
      await createHazardAssessment({
        airtableJobId: input.jobId,
        technicianName: tech.airtableName,
        phase: input.phase,
        answers: JSON.stringify(input.answers),
        hazardsIdentified: input.hazardsIdentified ?? null,
        controlMeasures: input.controlMeasures ?? null,
        ppeConfirmed: input.ppeConfirmed,
        signature: input.signature,
      });
      return { ok: true as const };
    }),

  checkIn: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        phase: phaseSchema,
        lat: z.number().optional(),
        lon: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tech = await resolveTechnician(ctx.user.id);
      if (!tech)
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a technician" });

      const hazard = await getHazardAssessment(
        input.jobId,
        tech.airtableName,
        input.phase,
      );
      if (!hazard) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Hazard Assessment required before check-in. Please complete it first.",
        });
      }

      const existing = await getOpenTimeLog(input.jobId, tech.airtableName);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You are already checked in for this job.",
        });
      }

      const id = await createTimeLog({
        airtableJobId: input.jobId,
        technicianName: tech.airtableName,
        phase: input.phase,
        checkInAt: new Date(),
        checkInLat: input.lat ?? null,
        checkInLon: input.lon ?? null,
      });
      return { ok: true as const, timeLogId: id };
    }),

  checkOut: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tech = await resolveTechnician(ctx.user.id);
      if (!tech)
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a technician" });
      const open = await getOpenTimeLog(input.jobId, tech.airtableName);
      if (!open) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active check-in found.",
        });
      }
      const checkOutAt = new Date();
      const checkInAt = open.checkInAt ? new Date(open.checkInAt) : checkOutAt;
      const hours = (checkOutAt.getTime() - checkInAt.getTime()) / (3600 * 1000);
      await closeTimeLog(open.id, checkOutAt, Math.round(hours * 100) / 100);
      return { ok: true as const, hours: Math.round(hours * 100) / 100 };
    }),

  // ---- Day session: warehouse check-in with truck + gated end-of-day ----

  // Everything the tech app needs for the day bar: session (truck), the truck
  // catalog to pick from, and the hazard/completion state of today's jobs.
  dayStatus: protectedProcedure.query(async ({ ctx }) => {
    const tech = await resolveTechnician(ctx.user.id);
    if (!tech) return null;
    const today = localDayKey(new Date());
    const [session, trucks, hazardsDone, rows] = await Promise.all([
      getDaySession(tech.airtableName, today),
      listTruckCatalog(),
      hazardJobIdsForDay(tech.airtableName, today),
      listConfirmedAssignmentRows(tech.airtableName),
    ]);
    // Today's jobs = confirmed assignments whose job window covers today.
    const jobIds = Array.from(new Set(rows.map((r) => r.airtableJobId)));
    const todaysJobs: {
      jobId: string;
      company: string | null;
      hazardDone: boolean;
      completed: boolean;
    }[] = [];
    for (const jobId of jobIds) {
      try {
        const job = await fetchJobById(jobId);
        const start = (job.startDate ?? "").slice(0, 10);
        const end = (job.endDate ?? "").slice(0, 10) || start;
        if (!start || today < start || today > end) continue;
        todaysJobs.push({
          jobId,
          company: job.company ?? null,
          hazardDone: hazardsDone.has(jobId),
          completed: rows.some(
            (r) => r.airtableJobId === jobId && r.completedAt != null,
          ),
        });
      } catch {
        // Skip jobs we can't fetch.
      }
    }
    const missingHazards = todaysJobs.filter((j) => !j.hazardDone);
    return {
      date: today,
      session: session
        ? {
            truckName: session.truckName,
            truckCode: session.truckCode,
            checkInAt: session.checkInAt,
            checkOutAt: session.checkOutAt,
          }
        : null,
      trucks: trucks.map((t: any) => ({
        name: t.name,
        code: t.code ?? null,
        ref: t.ref ?? null,
      })),
      todaysJobs,
      missingHazardCount: missingHazards.length,
      canCheckOut: missingHazards.length === 0,
    };
  }),

  // Arrive at the warehouse: pick the truck you'll drive today.
  startDay: protectedProcedure
    .input(z.object({ truckName: z.string().min(1), truckCode: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const tech = await resolveTechnician(ctx.user.id);
      if (!tech)
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a technician" });
      const today = localDayKey(new Date());
      await startDaySession({
        technicianName: tech.airtableName,
        date: today,
        truckName: input.truckName,
        truckCode: input.truckCode ?? null,
      });
      await appendChangeHistory({
        airtableJobId: "__day__",
        actorUserId: ctx.user.id,
        actorName: tech.displayName,
        action: "day_check_in",
        fieldName: "truck",
        oldValue: null,
        newValue: `${input.truckName}${input.truckCode ? ` (${input.truckCode})` : ""}`,
        details: `Day ${today}`,
      });
      return { ok: true as const };
    }),

  // End-of-day check-out. BLOCKED until every job worked today has a hazard
  // assessment submitted today.
  endDay: protectedProcedure.mutation(async ({ ctx }) => {
    const tech = await resolveTechnician(ctx.user.id);
    if (!tech)
      throw new TRPCError({ code: "FORBIDDEN", message: "Not a technician" });
    const today = localDayKey(new Date());
    const [hazardsDone, rows] = await Promise.all([
      hazardJobIdsForDay(tech.airtableName, today),
      listConfirmedAssignmentRows(tech.airtableName),
    ]);
    const missing: string[] = [];
    for (const jobId of Array.from(new Set(rows.map((r) => r.airtableJobId)))) {
      try {
        const job = await fetchJobById(jobId);
        const start = (job.startDate ?? "").slice(0, 10);
        const end = (job.endDate ?? "").slice(0, 10) || start;
        if (!start || today < start || today > end) continue;
        if (!hazardsDone.has(jobId)) missing.push(job.company ?? jobId);
      } catch {
        // ignore
      }
    }
    if (missing.length > 0) {
      return { ok: false as const, missingHazards: missing };
    }
    await endDaySession(tech.airtableName, today);
    return { ok: true as const, missingHazards: [] as string[] };
  }),

  // Technician marks a job's work done (signs installed / picked up). Returns
  // hazardMissing so the UI can raise the reminder alarm immediately.
  completeJob: protectedProcedure
    .input(z.object({ jobId: z.string(), completed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const tech = await resolveTechnician(ctx.user.id);
      if (!tech)
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a technician" });
      await setAssignmentCompleted(input.jobId, tech.airtableName, input.completed);
      const today = localDayKey(new Date());
      const hazardsDone = await hazardJobIdsForDay(tech.airtableName, today);
      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: tech.displayName,
        action: input.completed ? "job_completed" : "job_uncompleted",
        fieldName: "completedAt",
        oldValue: null,
        newValue: input.completed ? new Date().toISOString() : null,
        details: null,
      });
      return {
        ok: true as const,
        hazardMissing: input.completed && !hazardsDone.has(input.jobId),
      };
    }),

  // Upload a field photo -> LOCAL storage + job_photos (Airtable read-only).
  uploadPhoto: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        category: z.enum(["before", "during", "after"]),
        dataBase64: z.string(),
        mimeType: z.string().default("image/jpeg"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tech = await resolveTechnician(ctx.user.id);
      if (!tech)
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a technician" });

      const base64 = input.dataBase64.includes(",")
        ? input.dataBase64.split(",")[1]
        : input.dataBase64;
      const buffer = Buffer.from(base64, "base64");
      const ext = input.mimeType.split("/")[1] ?? "jpg";
      const filename = `${input.category}-${Date.now()}.${ext}`;
      const key = `field-photos/${input.jobId}/${filename}`;
      const stored = await storagePut(key, buffer, input.mimeType);

      await createJobPhoto({
        airtableJobId: input.jobId,
        technicianName: tech.airtableName,
        category: input.category,
        storageKey: stored.key,
        storageUrl: stored.url,
        filename: `${input.category}_${filename}`,
      });

      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: tech.displayName,
        action: "field_photo",
        fieldName: "Field Photos",
        oldValue: null,
        newValue: filename,
        details: `Category: ${input.category}`,
      });

      const url = await storageGetSignedUrl(stored.key).catch(() => stored.url);
      return { ok: true as const, url };
    }),

  // Add a field note -> LOCAL job_notes (Airtable read-only).
  addFieldNote: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        note: z.string().min(1),
        // "novedades": incident reports about signs — stolen / lost / damaged.
        category: z.enum(["general", "stolen", "lost", "damaged"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tech = await resolveTechnician(ctx.user.id);
      if (!tech)
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a technician" });

      await createJobNote({
        airtableJobId: input.jobId,
        authorName: tech.displayName,
        authorRole: "technician",
        category: input.category ?? "general",
        note: input.note,
      });

      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: tech.displayName,
        action: "field_note",
        fieldName: "Field Commnets",
        oldValue: null,
        newValue: input.note,
        details: null,
      });
      return { ok: true as const };
    }),

  notifications: protectedProcedure.query(async ({ ctx }) => {
    const tech = await resolveTechnician(ctx.user.id);
    if (!tech) return { items: [], unread: 0 };
    const items = await listNotificationsForTechnician(tech.airtableName);
    const unread = await countUnreadNotifications(tech.airtableName);
    return { items, unread };
  }),

  markNotificationRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await markNotificationRead(input.id);
      return { ok: true as const };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const tech = await resolveTechnician(ctx.user.id);
    if (tech) await markAllNotificationsRead(tech.airtableName);
    return { ok: true as const };
  }),
});
