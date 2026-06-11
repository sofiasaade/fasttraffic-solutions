import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { fetchMapJobs, fetchJobById } from "../airtable";
import { AF, JobRecord } from "../../shared/airtableFields";
import { parseNonWorkingDays } from "../../shared/nonWorkingDays";
import {
  recommendWorkers as computeRecommendations,
  type ExperienceLevel,
} from "../../shared/workerRecommendation";
import { describeWeatherCode, DEFAULT_WEATHER_LOCATION } from "../../shared/weather";
import { invokeLLM } from "../_core/llm";
import {
  acknowledgeChanges,
  getActiveChangeBadges,
  getRecentChanges,
  runChangeDetection,
} from "../changeDetection";
import {
  detectConflicts,
  deriveZone,
  getPayPeriodFor,
  jobToInterval,
  computeOvertimeStatus,
} from "../../shared/opsLogic";
import {
  appendChangeHistory,
  createNotification,
  getAssignmentsMap,
  getJobOverride,
  getJobOverridesMap,
  listAllAssignmentsForTechnician,
  listAllChangeHistory,
  listAssignmentsForJob,
  listChangeHistory,
  listJobNotes,
  listJobPhotos,
  listOpenTimeLogs,
  listTechnicians,
  getOvertimeThreshold,
  seedTechnicians,
  setTechnicianLevel,
  setPhaseAssignments,
  setScheduledAssignment,
  listScheduledAssignmentsForWeek,
  removeAssignment,
  moveScheduledAssignment,
  listBookedTechniciansOnDate,
  setSetting,
  sumHoursInPeriod,
  upsertJobOverride,
  listEquipmentCatalog,
  seedEquipmentCatalog,
  setEquipmentAssignment,
  listEquipmentAssignmentsForWeek,
  removeEquipmentAssignment,
  moveEquipmentAssignment,
  listTruckCatalog,
  seedTruckCatalog,
  setTruckAssignment,
  listTruckAssignmentsForWeek,
  removeTruckAssignment,
  moveTruckAssignment,
  createBillingNote,
  listBillingNotes,
  getBillingNoteCounts,
  deleteBillingNote,
  getTechnicianProfile,
  upsertTechnicianProfile,
  listTechnicianCertificates,
  createTechnicianCertificate,
  deleteTechnicianCertificate,
  getCertificateCounts,
  listTechnicianAvailability,
  listAvailabilityForNames,
  setWeekdayAvailability,
  setDateAvailability,
  removeAvailabilityRule,
  setFlaggingHours,
  removeFlaggingHours,
  listFlaggingHoursForJob,
  listFlaggingHoursInWindow,
  listDayAssignments,
  createTimelineBlock,
  setTimelineBlockTime,
  moveTimelineBlock,
  removeTimelineBlock,
} from "../opsDb";
import { storageGetSignedUrl, storagePut } from "../storage";

const phaseSchema = z.enum(["Preparation", "Setup", "Pickup"]);

// --- Current weather (Open-Meteo, no API key) with a small in-process cache ---
type WeatherResult = {
  locationName: string;
  lat: number;
  lon: number;
  temperatureC: number | null;
  windKph: number | null;
  code: number | null;
  label: string;
  group: string;
  observedAt: string | null;
  ok: boolean;
};

const WEATHER_TTL_MS = 10 * 60 * 1000; // 10 minutes
const weatherCache = new Map<string, { at: number; value: WeatherResult }>();

async function getCachedWeather(
  lat: number,
  lon: number,
  name: string,
): Promise<WeatherResult> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.at < WEATHER_TTL_MS) return hit.value;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,wind_speed_10m&wind_speed_unit=kmh&timezone=auto`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`open-meteo ${resp.status}`);
    const data: any = await resp.json();
    const cur = data?.current ?? {};
    const code = typeof cur.weather_code === "number" ? cur.weather_code : null;
    const desc = describeWeatherCode(code ?? -1);
    const value: WeatherResult = {
      locationName: name,
      lat,
      lon,
      temperatureC: typeof cur.temperature_2m === "number" ? cur.temperature_2m : null,
      windKph: typeof cur.wind_speed_10m === "number" ? cur.wind_speed_10m : null,
      code,
      label: desc.label,
      group: desc.group,
      observedAt: typeof cur.time === "string" ? cur.time : null,
      ok: true,
    };
    weatherCache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    const value: WeatherResult = {
      locationName: name,
      lat,
      lon,
      temperatureC: null,
      windKph: null,
      code: null,
      label: "Unavailable",
      group: "clouds",
      observedAt: null,
      ok: false,
    };
    // Cache the failure briefly too, so we don't retry on every render.
    weatherCache.set(key, { at: Date.now(), value });
    return value;
  }
}

/**
 * Merge a base Airtable JobRecord with local operations data so the existing
 * UI contract (techPrep/techSetup/techPickup, endDate, subStatus) is preserved
 * while the local DB remains the source of truth. Airtable stays read-only.
 */
function mergeJob(
  job: JobRecord,
  assigns?: { Preparation: string[]; Setup: string[]; Pickup: string[] },
  override?: { endDate: string | null; subStatus: string | null },
) {
  const merged: JobRecord = {
    ...job,
    techPrep: assigns ? assigns.Preparation : [],
    techSetup: assigns ? assigns.Setup : [],
    techPickup: assigns ? assigns.Pickup : [],
    endDate: override?.endDate ?? job.endDate,
    subStatus: override?.subStatus ?? job.subStatus,
  };
  return { ...merged, zone: deriveZone(merged as any) };
}

export const coordinatorRouter = router({
  // Dispatch board: Field + Permit Approved + Permit Request Submitted, merged
  // with local assignments and overrides.
  dispatchJobs: adminProcedure.query(async () => {
    const jobs = await fetchMapJobs();
    const ids = jobs.map((j) => j.id);
    const [assignMap, overrideMap] = await Promise.all([
      getAssignmentsMap(ids),
      getJobOverridesMap(ids),
    ]);
    return jobs.map((j) => mergeJob(j, assignMap.get(j.id), overrideMap.get(j.id)));
  }),

  // Board table: same merged shape for all three statuses.
  boardJobs: adminProcedure.query(async () => {
    const jobs = await fetchMapJobs();
    const ids = jobs.map((j) => j.id);
    const [assignMap, overrideMap] = await Promise.all([
      getAssignmentsMap(ids),
      getJobOverridesMap(ids),
    ]);
    return jobs.map((j) => mergeJob(j, assignMap.get(j.id), overrideMap.get(j.id)));
  }),

  // Jobs for the coordinator map view, with local overrides applied.
  mapJobs: adminProcedure.query(async () => {
    const jobs = await fetchMapJobs();
    const ids = jobs.map((j) => j.id);
    const overrideMap = await getJobOverridesMap(ids);
    return jobs.map((j) => {
      const z = mergeJob(j, undefined, overrideMap.get(j.id));
      return {
        id: z.id,
        company: z.company,
        jobAddress: z.jobAddress,
        municipality: z.municipality,
        startDate: z.startDate,
        endDate: z.endDate,
        setupDuration: z.setupDuration,
        status: z.status,
        subStatus: z.subStatus,
        zone: z.zone,
        lat: z.lat,
        lon: z.lon,
      };
    });
  }),

  jobDetail: adminProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const job = await fetchJobById(input.jobId);
      const [assigns, override, history, photos, notes] = await Promise.all([
        listAssignmentsForJob(input.jobId),
        getJobOverride(input.jobId),
        listChangeHistory(input.jobId),
        listJobPhotos(input.jobId),
        listJobNotes(input.jobId),
      ]);
      const grouped = { Preparation: [] as string[], Setup: [] as string[], Pickup: [] as string[] };
      for (const a of assigns) {
        if (a.phase in grouped) grouped[a.phase as keyof typeof grouped].push(a.technicianName);
      }
      const merged = mergeJob(
        job,
        grouped,
        override ? { endDate: override.endDate, subStatus: override.subStatus } : undefined,
      );
      return { job: merged, history, photos, notes };
    }),

  technicians: adminProcedure.query(async () => {
    await seedTechnicians();
    return listTechnicians();
  }),

  // Set a technician's experience level (apprentice | junior | senior). LOCAL only.
  setTechnicianLevel: adminProcedure
    .input(
      z.object({
        airtableName: z.string(),
        level: z.enum(["apprentice", "junior", "senior"]),
      }),
    )
    .mutation(async ({ input }) => {
      await setTechnicianLevel(input.airtableName, input.level);
      return { ok: true as const };
    }),

  // Assign or unassign technicians for a phase — writes LOCALLY (Airtable read-only).
  assignTechnicians: adminProcedure
    .input(
      z.object({
        jobId: z.string(),
        phase: phaseSchema,
        technicians: z.array(z.string()),
        force: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const job = await fetchJobById(input.jobId);
      const targetInterval = jobToInterval(job);

      // Current local assignments for this phase (the "before" set).
      const existingForJob = await listAssignmentsForJob(input.jobId);
      const oldValue = existingForJob
        .filter((a) => a.phase === input.phase)
        .map((a) => a.technicianName);

      // Conflict detection against other jobs this technician is already on
      // (local assignments), using Airtable date intervals.
      const conflicts: {
        technician: string;
        otherJobId: string;
        otherJobLabel: string;
      }[] = [];

      if (targetInterval) {
        const previous = new Set(oldValue);
        const newlyAdded = input.technicians.filter((t) => !previous.has(t));

        for (const tech of newlyAdded) {
          const techAssigns = await listAllAssignmentsForTechnician(tech);
          const otherJobIds = Array.from(
            new Set(
              techAssigns
                .map((a) => a.airtableJobId)
                .filter((id) => id !== input.jobId),
            ),
          );

          const otherIntervals: { jobId: string; iv: NonNullable<ReturnType<typeof jobToInterval>>; label: string }[] = [];
          for (const oid of otherJobIds) {
            try {
              const oj = await fetchJobById(oid);
              const iv = jobToInterval(oj);
              if (iv)
                otherIntervals.push({
                  jobId: oid,
                  iv,
                  label: `${oj.company ?? "Job"} — ${oj.jobAddress ?? ""}`,
                });
            } catch {
              // ignore jobs we can't fetch
            }
          }

          const res = detectConflicts(
            targetInterval,
            otherIntervals.map((x) => x.iv),
          );
          if (res.hasConflict) {
            for (const c of res.conflicts) {
              const other = otherIntervals.find((x) => x.iv.jobId === c.otherJobId);
              conflicts.push({
                technician: tech,
                otherJobId: c.otherJobId,
                otherJobLabel: other ? other.label : c.otherJobId,
              });
            }
          }
        }
      }

      if (conflicts.length > 0 && !input.force) {
        return { ok: false as const, conflicts };
      }

      // Persist locally (replace full phase set).
      await setPhaseAssignments(input.jobId, input.phase, input.technicians, {
        userId: ctx.user.id,
        name: ctx.user.name ?? ctx.user.email ?? "Coordinator",
      });

      // Immutable change history.
      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
        action: "assign_technician",
        fieldName: input.phase,
        oldValue: JSON.stringify(oldValue),
        newValue: JSON.stringify(input.technicians),
        details: `Phase: ${input.phase}${conflicts.length ? " (forced over conflict)" : ""}`,
      });

      // Notifications: newly assigned / removed.
      const before = new Set(oldValue);
      const after = new Set(input.technicians);
      const jobLabel = `${job.company ?? "Job"} — ${job.jobAddress ?? ""}`;
      for (const t of input.technicians) {
        if (!before.has(t)) {
          await createNotification({
            technicianName: t,
            airtableJobId: input.jobId,
            type: "assigned",
            title: `New ${input.phase} assignment`,
            body: jobLabel,
          });
        }
      }
      for (const t of oldValue) {
        if (!after.has(t)) {
          await createNotification({
            technicianName: t,
            airtableJobId: input.jobId,
            type: "cancelled",
            title: `Removed from ${input.phase}`,
            body: jobLabel,
          });
        }
      }

      // Return merged job so UI sees updated assignments.
      const assigns = await listAssignmentsForJob(input.jobId);
      const grouped = { Preparation: [] as string[], Setup: [] as string[], Pickup: [] as string[] };
      for (const a of assigns) {
        if (a.phase in grouped) grouped[a.phase as keyof typeof grouped].push(a.technicianName);
      }
      const override = await getJobOverride(input.jobId);
      const merged = mergeJob(
        job,
        grouped,
        override ? { endDate: override.endDate, subStatus: override.subStatus } : undefined,
      );
      return { ok: true as const, job: merged, conflicts };
    }),

  // Modify a job: end date and/or sub-status — stored LOCALLY as overrides.
  modifyJob: adminProcedure
    .input(
      z.object({
        jobId: z.string(),
        endDate: z.string().optional(),
        subStatus: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const job = await fetchJobById(input.jobId);
      const override = await getJobOverride(input.jobId);

      const currentEnd = override?.endDate ?? job.endDate ?? "";
      const currentSub = override?.subStatus ?? job.subStatus ?? "";

      const changes: { field: string; old: string; new: string; action: string }[] = [];
      const patch: { endDate?: string; subStatus?: string } = {};

      if (input.endDate !== undefined) {
        patch.endDate = input.endDate;
        changes.push({
          field: AF.endDate,
          old: currentEnd,
          new: input.endDate,
          action: "extend_end_date",
        });
      }
      if (input.subStatus !== undefined) {
        patch.subStatus = input.subStatus;
        changes.push({
          field: AF.subStatus,
          old: currentSub,
          new: input.subStatus,
          action: "change_sub_status",
        });
      }

      if (changes.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No changes provided" });
      }

      await upsertJobOverride(input.jobId, patch, {
        userId: ctx.user.id,
        name: ctx.user.name ?? ctx.user.email ?? "Coordinator",
      });

      for (const c of changes) {
        await appendChangeHistory({
          airtableJobId: input.jobId,
          actorUserId: ctx.user.id,
          actorName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
          action: c.action,
          fieldName: c.field,
          oldValue: c.old,
          newValue: c.new,
          details: input.reason ?? null,
        });
      }

      // Notify all locally-assigned techs of the modification.
      const assigns = await listAssignmentsForJob(input.jobId);
      const assignedTechs = new Set(assigns.map((a) => a.technicianName));
      const jobLabel = `${job.company ?? "Job"} — ${job.jobAddress ?? ""}`;
      for (const t of Array.from(assignedTechs)) {
        await createNotification({
          technicianName: t,
          airtableJobId: input.jobId,
          type: "modified",
          title: "Job updated",
          body: jobLabel,
        });
      }

      const grouped = { Preparation: [] as string[], Setup: [] as string[], Pickup: [] as string[] };
      for (const a of assigns) {
        if (a.phase in grouped) grouped[a.phase as keyof typeof grouped].push(a.technicianName);
      }
      const merged = mergeJob(job, grouped, {
        endDate: patch.endDate ?? override?.endDate ?? null,
        subStatus: patch.subStatus ?? override?.subStatus ?? null,
      });
      return { ok: true as const, job: merged };
    }),

  // Coordinator internal note (change history only).
  addInternalNote: adminProcedure
    .input(z.object({ jobId: z.string(), note: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
        action: "internal_note",
        fieldName: null,
        oldValue: null,
        newValue: input.note,
        details: "Coordinator internal note",
      });
      return { ok: true as const };
    }),

  changeHistory: adminProcedure
    .input(z.object({ jobId: z.string().optional() }))
    .query(async ({ input }) => {
      if (input.jobId) return listChangeHistory(input.jobId);
      return listAllChangeHistory();
    }),

  // Overtime dashboard for the current (or given) pay period.
  overtime: adminProcedure
    .input(z.object({ date: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const ref = input?.date ? new Date(input.date) : new Date();
      const period = getPayPeriodFor(ref);
      const threshold = await getOvertimeThreshold();
      const sums = await sumHoursInPeriod(period.start, period.end);

      const open = await listOpenTimeLogs();
      const liveByTech = new Map<string, number>();
      const now = Date.now();
      for (const log of open) {
        if (!log.checkInAt) continue;
        const checkIn = new Date(log.checkInAt).getTime();
        if (checkIn >= period.start.getTime() && checkIn < period.end.getTime()) {
          const h = (now - checkIn) / (3600 * 1000);
          liveByTech.set(
            log.technicianName,
            (liveByTech.get(log.technicianName) ?? 0) + h,
          );
        }
      }

      const byTech = new Map<string, number>();
      for (const row of sums) {
        byTech.set(row.technicianName, Number(row.total));
      }
      for (const [t, h] of Array.from(liveByTech.entries())) {
        byTech.set(t, (byTech.get(t) ?? 0) + h);
      }

      const technicians = await listTechnicians();
      const statuses = technicians.map((tech) => {
        const hours = byTech.get(tech.airtableName) ?? 0;
        return {
          ...computeOvertimeStatus(tech.displayName, hours, threshold),
          airtableName: tech.airtableName,
        };
      });

      return {
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
        threshold,
        statuses: statuses.sort((a, b) => b.hours - a.hours),
      };
    }),

  setOvertimeThreshold: adminProcedure
    .input(z.object({ threshold: z.number().min(1).max(168) }))
    .mutation(async ({ input }) => {
      await setSetting("overtime_threshold", String(input.threshold));
      return { ok: true as const, threshold: input.threshold };
    }),

  /* ---------------- Day & time-specific scheduler (local only) ---------- */

  // All day-pinned assignments for a visible week (inclusive date range).
  scheduledAssignments: adminProcedure
    .input(z.object({ startDate: z.string(), endDate: z.string() }))
    .query(async ({ input }) => {
      const rows = await listScheduledAssignmentsForWeek(
        input.startDate,
        input.endDate,
      );
      return rows.map((r) => ({
        id: r.id,
        jobId: r.airtableJobId,
        phase: r.phase,
        technicianName: r.technicianName,
        scheduledDate: r.scheduledDate,
        startTime: r.startTime,
        endTime: r.endTime,
      }));
    }),

  // Pin a technician to a job on a specific day + time window.
  setScheduled: adminProcedure
    .input(
      z.object({
        jobId: z.string(),
        phase: phaseSchema,
        technicianName: z.string(),
        scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        startTime: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
        endTime: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
        force: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const job = await fetchJobById(input.jobId);

      // Availability check: is this technician already booked that day on a
      // DIFFERENT job? Block unless forced.
      const bookedNames = await listBookedTechniciansOnDate(input.scheduledDate);
      const sameDayRows = await listScheduledAssignmentsForWeek(
        input.scheduledDate,
        input.scheduledDate,
      );
      const conflict = sameDayRows.find(
        (r) =>
          r.technicianName === input.technicianName &&
          r.airtableJobId !== input.jobId,
      );
      if (conflict && !input.force) {
        let label = conflict.airtableJobId;
        try {
          const oj = await fetchJobById(conflict.airtableJobId);
          label = `${oj.company ?? "Job"} — ${oj.jobAddress ?? ""}`;
        } catch {
          /* keep id */
        }
        return {
          ok: false as const,
          conflicts: [
            { technician: input.technicianName, otherJobLabel: label },
          ],
        };
      }

      const id = await setScheduledAssignment({
        airtableJobId: input.jobId,
        phase: input.phase,
        technicianName: input.technicianName,
        scheduledDate: input.scheduledDate,
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        actor: {
          userId: ctx.user.id,
          name: ctx.user.name ?? ctx.user.email ?? "Coordinator",
        },
      });

      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
        action: "schedule_assignment",
        fieldName: input.phase,
        oldValue: null,
        newValue: `${input.technicianName} @ ${input.scheduledDate}${
          input.startTime ? ` ${input.startTime}-${input.endTime ?? ""}` : ""
        }`,
        details: bookedNames.includes(input.technicianName) && conflict
          ? "Scheduled (forced over day conflict)"
          : "Scheduled",
      });

      await createNotification({
        technicianName: input.technicianName,
        airtableJobId: input.jobId,
        type: "assigned",
        title: `Scheduled: ${input.phase} on ${input.scheduledDate}`,
        body: `${job.company ?? "Job"} — ${job.jobAddress ?? ""}`,
      });

      return { ok: true as const, id };
    }),

  // Remove a single day-pinned assignment (by row id).
  removeScheduled: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await removeAssignment(input.id);
      return { ok: true as const };
    }),

  // Move an existing worker assignment to another day (drag within a job).
  // Honors the same-day conflict check unless forced.
  moveScheduled: adminProcedure
    .input(
      z.object({
        id: z.number(),
        scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        force: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Look up the row to know which technician/job is moving.
      const sameDayRows = await listScheduledAssignmentsForWeek(
        input.scheduledDate,
        input.scheduledDate,
      );
      const moving = (
        await listScheduledAssignmentsForWeek("0000-01-01", "9999-12-31")
      ).find((r) => r.id === input.id);
      if (!moving) return { ok: false as const, reason: "not_found" as const };

      const conflict = sameDayRows.find(
        (r) =>
          r.technicianName === moving.technicianName &&
          r.airtableJobId !== moving.airtableJobId,
      );
      if (conflict && !input.force) {
        let label = conflict.airtableJobId;
        try {
          const oj = await fetchJobById(conflict.airtableJobId);
          label = `${oj.company ?? "Job"} — ${oj.jobAddress ?? ""}`;
        } catch {
          /* keep id */
        }
        return {
          ok: false as const,
          reason: "conflict" as const,
          conflicts: [
            { technician: moving.technicianName, otherJobLabel: label },
          ],
        };
      }

      const id = await moveScheduledAssignment({
        id: input.id,
        scheduledDate: input.scheduledDate,
      });
      return { ok: true as const, id };
    }),

  /* ------------------------- Equipment (local only) ------------------------- */

  // Draggable equipment catalog for the Scheduler "Equipment" tab.
  equipmentCatalog: adminProcedure.query(async () => {
    const rows = await listEquipmentCatalog();
    if (rows.length === 0) {
      await seedEquipmentCatalog();
      return listEquipmentCatalog();
    }
    return rows;
  }),

  // All equipment placements for a visible week (inclusive date range).
  equipmentAssignments: adminProcedure
    .input(z.object({ startDate: z.string(), endDate: z.string() }))
    .query(async ({ input }) => {
      const rows = await listEquipmentAssignmentsForWeek(
        input.startDate,
        input.endDate,
      );
      return rows.map((r) => ({
        id: r.id,
        jobId: r.airtableJobId,
        equipmentName: r.equipmentName,
        scheduledDate: r.scheduledDate,
        technicianName: r.technicianName,
        quantity: r.quantity,
        notes: r.notes,
      }));
    }),

  // Place a piece of equipment on a job for a specific day, optionally with a
  // technician responsible for installing it (e.g. No Parking signs the day before).
  setEquipment: adminProcedure
    .input(
      z.object({
        jobId: z.string(),
        equipmentName: z.string().min(1),
        scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        technicianName: z.string().optional(),
        quantity: z.number().int().min(1).max(999).optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const job = await fetchJobById(input.jobId);
      const id = await setEquipmentAssignment({
        airtableJobId: input.jobId,
        equipmentName: input.equipmentName,
        scheduledDate: input.scheduledDate,
        technicianName: input.technicianName ?? null,
        quantity: input.quantity ?? 1,
        notes: input.notes ?? null,
        actor: {
          userId: ctx.user.id,
          name: ctx.user.name ?? ctx.user.email ?? "Coordinator",
        },
      });

      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
        action: "schedule_equipment",
        fieldName: input.equipmentName,
        oldValue: null,
        newValue: `${input.quantity ?? 1}x ${input.equipmentName} @ ${input.scheduledDate}${
          input.technicianName ? ` (install: ${input.technicianName})` : ""
        }`,
        details: input.notes ?? "Equipment scheduled",
      });

      // If a technician was assigned to install it, notify them.
      if (input.technicianName) {
        await createNotification({
          technicianName: input.technicianName,
          airtableJobId: input.jobId,
          type: "assigned",
          title: `Install ${input.equipmentName} on ${input.scheduledDate}`,
          body: `${job.company ?? "Job"} — ${job.jobAddress ?? ""}`,
        });
      }

      return { ok: true as const, id };
    }),

  // Remove a single equipment placement (by row id).
  removeEquipment: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await removeEquipmentAssignment(input.id);
      return { ok: true as const };
    }),

  // Move an existing equipment placement to another day.
  moveEquipment: adminProcedure
    .input(
      z.object({
        id: z.number(),
        scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ input }) => {
      const id = await moveEquipmentAssignment(input);
      return { ok: id !== null, id };
    }),

  /* ------------------------------- Trucks -------------------------------- */

  // The fleet catalog. Re-seed on every read so the latest fleet details
  // (code / ref / description / VIN / plate / color) stay in sync; seeding
  // is idempotent via onDuplicateKeyUpdate.
  truckCatalog: adminProcedure.query(async () => {
    await seedTruckCatalog();
    return listTruckCatalog();
  }),

  // All truck placements for a visible week (inclusive date range).
  truckAssignments: adminProcedure
    .input(z.object({ startDate: z.string(), endDate: z.string() }))
    .query(async ({ input }) => {
      const rows = await listTruckAssignmentsForWeek(
        input.startDate,
        input.endDate,
      );
      return rows.map((r) => ({
        id: r.id,
        jobId: r.airtableJobId,
        truckName: r.truckName,
        scheduledDate: r.scheduledDate,
        driverName: r.driverName,
        notes: r.notes,
      }));
    }),

  // Assign a truck to a job for a specific day, optionally with the worker who
  // will drive it that day.
  setTruck: adminProcedure
    .input(
      z.object({
        jobId: z.string(),
        truckName: z.string().min(1),
        scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        driverName: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const job = await fetchJobById(input.jobId);
      const id = await setTruckAssignment({
        airtableJobId: input.jobId,
        truckName: input.truckName,
        scheduledDate: input.scheduledDate,
        driverName: input.driverName ?? null,
        notes: input.notes ?? null,
        actor: {
          userId: ctx.user.id,
          name: ctx.user.name ?? ctx.user.email ?? "Coordinator",
        },
      });

      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
        action: "schedule_truck",
        fieldName: input.truckName,
        oldValue: null,
        newValue: `${input.truckName} @ ${input.scheduledDate}${
          input.driverName ? ` (driver: ${input.driverName})` : ""
        }`,
        details: input.notes ?? "Truck scheduled",
      });

      // Notify the assigned driver, if any.
      if (input.driverName) {
        await createNotification({
          technicianName: input.driverName,
          airtableJobId: input.jobId,
          type: "assigned",
          title: `Drive ${input.truckName} on ${input.scheduledDate}`,
          body: `${job.company ?? "Job"} — ${job.jobAddress ?? ""}`,
        });
      }

      return { ok: true as const, id };
    }),

  // Move an existing truck placement to another day (driver preserved).
  moveTruck: adminProcedure
    .input(
      z.object({
        id: z.number(),
        scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ input }) => {
      const id = await moveTruckAssignment(input);
      return { ok: id !== null, id };
    }),

  // Remove a single truck assignment (by row id).
  removeTruck: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await removeTruckAssignment(input.id);
      return { ok: true as const };
    }),

  // --- 5-day change detection (snapshots/diffs of Airtable jobs) ---

  // Alerts tray: recent changes within the planning window.
  recentChanges: adminProcedure.query(async () => {
    return getRecentChanges();
  }),

  // Map of airtableJobId -> unacknowledged changes, for row badges.
  changeBadges: adminProcedure.query(async () => {
    return getActiveChangeBadges();
  }),

  // Mark a set of changes as seen (dismiss from the tray/badges).
  acknowledgeChanges: adminProcedure
    .input(z.object({ ids: z.array(z.number()).min(1) }))
    .mutation(async ({ input }) => {
      const n = await acknowledgeChanges(input.ids);
      return { ok: true as const, acknowledged: n };
    }),

  // Manually run a detection pass now (does not wait for the daily cron).
  runChangeDetection: adminProcedure.mutation(async () => {
    const result = await runChangeDetection();
    return result;
  }),

  // Current weather for the operation location (Open-Meteo, no API key).
  // Cached in-process for 10 minutes to avoid hammering the upstream API.
  currentWeather: adminProcedure
    .input(
      z
        .object({ lat: z.number().optional(), lon: z.number().optional() })
        .optional(),
    )
    .query(async ({ input }) => {
      const lat = input?.lat ?? DEFAULT_WEATHER_LOCATION.lat;
      const lon = input?.lon ?? DEFAULT_WEATHER_LOCATION.lon;
      const name =
        input?.lat != null ? `${lat.toFixed(2)}, ${lon.toFixed(2)}` : DEFAULT_WEATHER_LOCATION.name;
      return getCachedWeather(lat, lon, name);
    }),

  /**
   * Interpret a free-text "Client message" into non-working days.
   * First tries the deterministic "NO WORK:" parser; if no directive is found
   * and the message is non-trivial, falls back to an LLM extraction.
   * Returns recurring weekday indices (0=Sun..6=Sat) + explicit date keys.
   */
  interpretNonWorkingDays: adminProcedure
    .input(z.object({ message: z.string().max(4000) }))
    .mutation(async ({ input }) => {
      const deterministic = parseNonWorkingDays(input.message);
      if (deterministic.hasDirective) {
        return { ...deterministic, source: "directive" as const };
      }
      const text = input.message.trim();
      if (text.length < 4) {
        return { weekdays: [], dates: [], reason: null, source: "none" as const };
      }
      try {
        const resp = await invokeLLM({
          messages: [
            {
              role: "system",
              content:
                "You extract non-working days from a traffic-control client's message. " +
                "Return JSON only. weekdays: array of integers 0-6 (0=Sunday..6=Saturday) " +
                "for recurring closed days. dates: array of YYYY-MM-DD strings for specific " +
                "closed dates. If nothing indicates a non-working day, return empty arrays. " +
                "reason: a short human-readable summary or null.",
            },
            { role: "user", content: text },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "non_working_days",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  weekdays: { type: "array", items: { type: "integer" } },
                  dates: { type: "array", items: { type: "string" } },
                  reason: { type: ["string", "null"] },
                },
                required: ["weekdays", "dates", "reason"],
                additionalProperties: false,
              },
            },
          },
        });
        const raw = resp.choices?.[0]?.message?.content ?? "{}";
        const parsed = JSON.parse(typeof raw === "string" ? raw : "{}");
        const weekdays: number[] = Array.isArray(parsed.weekdays)
          ? parsed.weekdays.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6)
          : [];
        const dates: string[] = Array.isArray(parsed.dates)
          ? parsed.dates.filter((d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
          : [];
        return {
          weekdays: Array.from(new Set(weekdays)).sort((a, b) => a - b),
          dates: Array.from(new Set(dates)).sort(),
          reason: typeof parsed.reason === "string" ? parsed.reason : null,
          source: "llm" as const,
        };
      } catch {
        // On any LLM/parse failure, fail safe to "no non-working days".
        return { weekdays: [], dates: [], reason: null, source: "none" as const };
      }
    }),

  /* ----------------------- Billing notes (Novedades) ---------------------- */

  // List billing notes for one job (newest first).
  listBillingNotes: adminProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      return listBillingNotes(input.jobId);
    }),

  // Counts of billing notes per job id, for row badges in the Scheduler.
  billingNoteCounts: adminProcedure
    .input(z.object({ jobIds: z.array(z.string()) }))
    .query(async ({ input }) => {
      return getBillingNoteCounts(input.jobIds);
    }),

  // Add a billing note to a job.
  addBillingNote: adminProcedure
    .input(
      z.object({
        jobId: z.string(),
        // Free note still required so every entry has context
        note: z.string().trim().min(1).max(2000),
        // Structured invoicing fields (all optional)
        extraSignage: z.string().trim().max(500).optional(),
        weekendSurcharge: z.boolean().optional(),
        holidaySurcharge: z.boolean().optional(),
        planStamped: z.enum(["yes", "no", "unknown"]).optional(),
        chargeAmountCents: z.number().int().min(0).max(100_000_00).optional(),
        chargeCategory: z.string().trim().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = await createBillingNote({
        airtableJobId: input.jobId,
        note: input.note,
        extraSignage: input.extraSignage?.trim() || null,
        weekendSurcharge: input.weekendSurcharge ?? false,
        holidaySurcharge: input.holidaySurcharge ?? false,
        planStamped: input.planStamped ?? "unknown",
        chargeAmountCents:
          input.chargeAmountCents != null && input.chargeAmountCents > 0
            ? input.chargeAmountCents
            : null,
        chargeCategory: input.chargeCategory?.trim() || null,
        authorName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
        authorUserId: ctx.user.id,
      });
      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
        action: "billing_note",
        details: input.note.slice(0, 200),
      });
      return { ok: true as const, id };
    }),

  // Delete a billing note (only the author can delete their own).
  deleteBillingNote: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteBillingNote(input.id, ctx.user.id);
      return { ok: true as const };
    }),

  /* ------------------ Technician profile / certs / availability ----------- */

  // Full profile bundle for one technician: profile text + certificates + availability.
  technicianProfile: adminProcedure
    .input(z.object({ airtableName: z.string() }))
    .query(async ({ input }) => {
      const [profile, certificates, availability] = await Promise.all([
        getTechnicianProfile(input.airtableName),
        listTechnicianCertificates(input.airtableName),
        listTechnicianAvailability(input.airtableName),
      ]);
      // Sign certificate URLs so they resolve through the storage proxy.
      const certs = await Promise.all(
        certificates.map(async (c) => ({
          ...c,
          fileUrl: c.fileKey
            ? await storageGetSignedUrl(c.fileKey).catch(() => c.fileUrl)
            : c.fileUrl,
        })),
      );
      return { profile, certificates: certs, availability };
    }),

  // Create/update the professional profile (experience summary, headline, years).
  saveTechnicianProfile: adminProcedure
    .input(
      z.object({
        airtableName: z.string(),
        headline: z.string().trim().max(255).optional(),
        experienceSummary: z.string().trim().max(5000).optional(),
        yearsExperience: z.number().int().min(0).max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await upsertTechnicianProfile({
        airtableName: input.airtableName,
        headline: input.headline?.trim() || null,
        experienceSummary: input.experienceSummary?.trim() || null,
        yearsExperience: input.yearsExperience ?? null,
        updatedByUserId: ctx.user.id,
        updatedByName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
      });
      return { ok: true as const, profile };
    }),

  // Counts of certificates per technician name (for list badges).
  certificateCounts: adminProcedure
    .input(z.object({ airtableNames: z.array(z.string()) }))
    .query(async ({ input }) => {
      return getCertificateCounts(input.airtableNames);
    }),

  // Upload a safety certificate file (PDF/image) to S3 + metadata row.
  uploadCertificate: adminProcedure
    .input(
      z.object({
        airtableName: z.string(),
        name: z.string().trim().min(1).max(255),
        issuer: z.string().trim().max(255).optional(),
        issuedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        // Optional file: base64 data + mime; allowed when present.
        dataBase64: z.string().optional(),
        mimeType: z.string().max(128).optional(),
        fileName: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let fileKey: string | null = null;
      let fileUrl: string | null = null;
      if (input.dataBase64 && input.dataBase64.length > 0) {
        const base64 = input.dataBase64.includes(",")
          ? input.dataBase64.split(",")[1]
          : input.dataBase64;
        const buffer = Buffer.from(base64, "base64");
        const mime = input.mimeType || "application/pdf";
        const ext = (input.fileName?.split(".").pop() || mime.split("/")[1] || "pdf").slice(0, 8);
        const safeName = `${Date.now()}.${ext}`;
        const key = `tech-certs/${input.airtableName.replace(/[^a-zA-Z0-9_-]/g, "_")}/${safeName}`;
        const stored = await storagePut(key, buffer, mime);
        fileKey = stored.key;
        fileUrl = stored.url;
      }
      const id = await createTechnicianCertificate({
        airtableName: input.airtableName,
        name: input.name,
        issuer: input.issuer?.trim() || null,
        issuedDate: input.issuedDate || null,
        expiryDate: input.expiryDate || null,
        fileKey,
        fileUrl,
        fileName: input.fileName || null,
        mimeType: input.mimeType || null,
        uploadedByUserId: ctx.user.id,
        uploadedByName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
      });
      return { ok: true as const, id };
    }),

  // Delete a certificate row (file bytes become unreferenced in S3).
  deleteCertificate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteTechnicianCertificate(input.id);
      return { ok: true as const };
    }),

  // Set a recurring weekday availability rule (0=Sun..6=Sat).
  setWeekdayAvailability: adminProcedure
    .input(
      z.object({
        airtableName: z.string(),
        weekday: z.number().int().min(0).max(6),
        available: z.boolean(),
        reason: z.string().trim().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = await setWeekdayAvailability({
        airtableName: input.airtableName,
        weekday: input.weekday,
        available: input.available,
        reason: input.reason?.trim() || null,
        updatedByName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
      });
      return { ok: true as const, id };
    }),

  // Set a specific-date availability override.
  setDateAvailability: adminProcedure
    .input(
      z.object({
        airtableName: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        available: z.boolean(),
        reason: z.string().trim().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = await setDateAvailability({
        airtableName: input.airtableName,
        date: input.date,
        available: input.available,
        reason: input.reason?.trim() || null,
        updatedByName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
      });
      return { ok: true as const, id };
    }),

  // Remove an availability rule by id.
  removeAvailabilityRule: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await removeAvailabilityRule(input.id);
      return { ok: true as const };
    }),

  /* --------------------------- Worker week grid --------------------------- */

  // Build the worker-week calendar: for each technician, the day-pinned project
  // assignments and their availability across a date range (inclusive).
  workerWeek: adminProcedure
    .input(
      z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ input }) => {
      await seedTechnicians();
      const techs = await listTechnicians();
      const names = techs.map((t) => t.airtableName);
      const [assigns, availability, jobs, certCounts] = await Promise.all([
        listScheduledAssignmentsForWeek(input.startDate, input.endDate),
        listAvailabilityForNames(names),
        fetchMapJobs(),
        getCertificateCounts(names),
      ]);
      // Map job id -> label/company for the assignment bars.
      const jobById = new Map(jobs.map((j) => [j.id, j]));
      const assignments = assigns.map((a) => {
        const j = a.airtableJobId ? jobById.get(a.airtableJobId) : undefined;
        return {
          id: a.id,
          technicianName: a.technicianName,
          airtableJobId: a.airtableJobId,
          phase: a.phase,
          scheduledDate: a.scheduledDate,
          startTime: a.startTime,
          endTime: a.endTime,
          company: j?.company ?? null,
          jobAddress: j?.jobAddress ?? null,
          municipality: j?.municipality ?? null,
        };
      });
      return {
        technicians: techs.map((t) => ({
          airtableName: t.airtableName,
          displayName: t.displayName,
          experienceLevel: t.experienceLevel,
          certificateCount: certCounts.get(t.airtableName) ?? 0,
        })),
        assignments,
        availability,
      };
    }),

  /* --------------------- Worker recommendation engine -------------------- */

  // Suggest technicians for a job based on its Airtable `impact` difficulty,
  // availability on the target date, and same-day double-booking. This is a
  // SUGGESTION ONLY — it never excludes anyone; the coordinator can override.
  recommendWorkers: adminProcedure
    .input(
      z.object({
        jobId: z.string(),
        // Optional target day (YYYY-MM-DD) to factor in availability + bookings.
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    )
    .query(async ({ input }) => {
      await seedTechnicians();
      const [job, techs] = await Promise.all([
        fetchJobById(input.jobId).catch(() => null),
        listTechnicians(),
      ]);
      const names = techs.map((t) => t.airtableName);
      const [availability, certCounts, bookedNames] = await Promise.all([
        listAvailabilityForNames(names),
        getCertificateCounts(names),
        input.date
          ? listBookedTechniciansOnDate(input.date)
          : Promise.resolve([] as string[]),
      ]);
      const bookedSet = new Set(bookedNames);

      // Availability resolver: date override beats weekday rule; default available.
      const wd = input.date ? new Date(input.date + "T12:00:00").getDay() : null;
      function isUnavailable(name: string): boolean {
        if (!input.date) return false;
        const rules = availability.filter((r) => r.airtableName === name);
        const dateRule = rules.find(
          (r) => r.kind === "date" && r.date === input.date,
        );
        if (dateRule) return !dateRule.available;
        const wdRule = rules.find(
          (r) => r.kind === "weekday" && r.weekday === wd,
        );
        if (wdRule) return !wdRule.available;
        return false;
      }

      const recoInput = techs.map((t) => ({
        airtableName: t.airtableName,
        displayName: t.displayName,
        experienceLevel: t.experienceLevel as ExperienceLevel,
        certificateCount: certCounts.get(t.airtableName) ?? 0,
        unavailable: isUnavailable(t.airtableName),
        alreadyBooked: bookedSet.has(t.airtableName),
      }));

      const { difficulty, recommendations } = computeRecommendations(
        recoInput,
        job?.impact ?? null,
      );
      return {
        difficulty,
        impact: job?.impact ?? null,
        recommendations,
      };
    }),

  /* --------------------------- Flagging hours ---------------------------- */

  // All billable flagging-hour rows for a job (newest day first).
  listFlaggingHours: adminProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const rows = await listFlaggingHoursForJob(input.jobId);
      const totalHours = rows.reduce((s, r) => s + Number(r.hours), 0);
      return { rows, totalHours };
    }),

  // Upsert flagging hours for one person on one day of one job.
  // Flagging is billed PER PERSON-HOUR: each flagger/day is its own row.
  setFlaggingHours: adminProcedure
    .input(
      z.object({
        jobId: z.string(),
        technicianName: z.string().min(1),
        workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hours: z.number().min(0).max(24),
        hourlyRateCents: z.number().int().min(0).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = await setFlaggingHours({
        airtableJobId: input.jobId,
        technicianName: input.technicianName,
        workDate: input.workDate,
        hours: input.hours,
        hourlyRateCents: input.hourlyRateCents ?? null,
        note: input.note ?? null,
        createdByUserId: ctx.user.id,
        createdByName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
      });
      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
        action: "flagging_hours",
        fieldName: "Flagging",
        oldValue: null,
        newValue: `${input.technicianName}: ${input.hours}h @ ${input.workDate}`,
        details: "Logged billable flagging hours",
      });
      return { ok: true as const, id };
    }),

  removeFlaggingHours: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await removeFlaggingHours(input.id);
      return { ok: true as const };
    }),

  // Weekly billing summary of flagging hours, aggregated by job and technician.
  flaggingSummary: adminProcedure
    .input(
      z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ input }) => {
      const rows = await listFlaggingHoursInWindow(
        input.startDate,
        input.endDate,
      );
      const byJob = new Map<
        string,
        { jobId: string; hours: number; amountCents: number; people: Set<string> }
      >();
      let totalHours = 0;
      let totalAmountCents = 0;
      for (const r of rows) {
        const h = Number(r.hours);
        const amt = r.hourlyRateCents ? Math.round(h * r.hourlyRateCents) : 0;
        totalHours += h;
        totalAmountCents += amt;
        const cur =
          byJob.get(r.airtableJobId) ?? {
            jobId: r.airtableJobId,
            hours: 0,
            amountCents: 0,
            people: new Set<string>(),
          };
        cur.hours += h;
        cur.amountCents += amt;
        cur.people.add(r.technicianName);
        byJob.set(r.airtableJobId, cur);
      }
      const jobs = Array.from(byJob.values()).map((j) => ({
        jobId: j.jobId,
        hours: j.hours,
        amountCents: j.amountCents,
        peopleCount: j.people.size,
      }));
      return { rows, jobs, totalHours, totalAmountCents };
    }),

  /* --------------------------- Day Timeline --------------------------- */

  // Projects scheduled on a given day, each with its hour-pinned blocks
  // (workers/equipment/trucks). Used by the Day Timeline view.
  dayTimeline: adminProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const date = input.date;
      const [jobs, dayAssigns, equipCatalog, truckCatalog] = await Promise.all([
        fetchMapJobs(),
        listDayAssignments(date),
        listEquipmentCatalog(),
        listTruckCatalog(),
      ]);
      const ids = jobs.map((j) => j.id);
      const overrideMap = await getJobOverridesMap(ids);

      const equipColor = new Map(
        equipCatalog.map((e) => [e.name, e.color ?? null] as const),
      );
      const truckColor = new Map(
        truckCatalog.map((t) => [t.name, t.color ?? null] as const),
      );

      // A job is shown on this day if its [startDate, endDate] window covers it,
      // OR it already has at least one block pinned on this day.
      const pinnedJobIds = new Set<string>([
        ...dayAssigns.workers.map((r) => r.airtableJobId),
        ...dayAssigns.equipment.map((r) => r.airtableJobId),
        ...dayAssigns.trucks.map((r) => r.airtableJobId),
      ]);

      const projects = jobs
        .map((j) => mergeJob(j, undefined, overrideMap.get(j.id)))
        .filter((j) => {
          if (pinnedJobIds.has(j.id)) return true;
          const start = (j.startDate ?? "").slice(0, 10);
          const end = (j.endDate ?? j.startDate ?? "").slice(0, 10);
          if (!start) return false;
          return start <= date && date <= (end || start);
        })
        .map((j) => {
          const workers = dayAssigns.workers
            .filter((r) => r.airtableJobId === j.id)
            .map((r) => ({
              kind: "worker" as const,
              id: r.id,
              name: r.technicianName,
              phase: r.phase,
              startTime: r.startTime,
              endTime: r.endTime,
              color: null as string | null,
            }));
          const equipment = dayAssigns.equipment
            .filter((r) => r.airtableJobId === j.id)
            .map((r) => ({
              kind: "equipment" as const,
              id: r.id,
              name: r.equipmentName,
              phase: null as string | null,
              startTime: r.startTime,
              endTime: r.endTime,
              color: equipColor.get(r.equipmentName) ?? null,
            }));
          const trucks = dayAssigns.trucks
            .filter((r) => r.airtableJobId === j.id)
            .map((r) => ({
              kind: "truck" as const,
              id: r.id,
              name: r.truckName,
              phase: null as string | null,
              driverName: r.driverName,
              startTime: r.startTime,
              endTime: r.endTime,
              color: truckColor.get(r.truckName) ?? null,
            }));
          return {
            id: j.id,
            company: j.company,
            jobAddress: j.jobAddress,
            emoji: (j as any).emoji ?? null,
            closureType: (j as any).closureType ?? null,
            impact: (j as any).impact ?? null,
            setupDuration: j.setupDuration ?? null,
            calendarInfo: (j as any).calendarInfo ?? null,
            status: j.status,
            subStatus: j.subStatus,
            blocks: [...workers, ...equipment, ...trucks],
          };
        })
        .sort((a, b) => (a.company || "").localeCompare(b.company || ""));

      return { date, projects };
    }),

  // Create a new hour-pinned block on a project (worker/equipment/truck).
  addTimelineBlock: adminProcedure
    .input(
      z.object({
        kind: z.enum(["worker", "equipment", "truck"]),
        airtableJobId: z.string(),
        scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        name: z.string().min(1),
        phase: z.string().optional(),
        driverName: z.string().optional(),
        technicianName: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = await createTimelineBlock({
        kind: input.kind,
        airtableJobId: input.airtableJobId,
        scheduledDate: input.scheduledDate,
        startTime: input.startTime,
        endTime: input.endTime,
        name: input.name,
        phase: input.phase ?? null,
        driverName: input.driverName ?? null,
        technicianName: input.technicianName ?? null,
        actor: { userId: ctx.user.id, name: ctx.user.name ?? undefined },
      });
      return { id };
    }),

  // Resize a block (change start/end time only).
  setTimelineTime: adminProcedure
    .input(
      z.object({
        kind: z.enum(["worker", "equipment", "truck"]),
        id: z.number(),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .mutation(async ({ input }) => {
      await setTimelineBlockTime(input);
      return { ok: true as const };
    }),

  // Move a block to another project / day / hour (keeps identity, no merge).
  moveTimelineBlock: adminProcedure
    .input(
      z.object({
        kind: z.enum(["worker", "equipment", "truck"]),
        id: z.number(),
        airtableJobId: z.string(),
        scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .mutation(async ({ input }) => {
      await moveTimelineBlock(input);
      return { ok: true as const };
    }),

  // Remove a block.
  removeTimelineBlock: adminProcedure
    .input(
      z.object({
        kind: z.enum(["worker", "equipment", "truck"]),
        id: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      await removeTimelineBlock(input);
      return { ok: true as const };
    }),
});
