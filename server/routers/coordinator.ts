import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  appendToTextField,
  fetchDispatchJobs,
  fetchJobById,
  updateJobFields,
} from "../airtable";
import {
  AF,
  JobPhase,
  PHASE_TO_FIELD,
} from "../../shared/airtableFields";
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
  getOvertimeThreshold,
  listAllChangeHistory,
  listChangeHistory,
  listTechnicians,
  seedTechnicians,
  setSetting,
  sumHoursInPeriod,
  listOpenTimeLogs,
} from "../opsDb";

const phaseSchema = z.enum(["Preparation", "Setup", "Pickup"]);

// Enrich a JobRecord with a derived zone for the client.
function withZone<T extends { municipality: string | null; jobAddress: string | null }>(
  job: T,
) {
  return { ...job, zone: deriveZone(job as any) };
}

export const coordinatorRouter = router({
  // Dispatch board: all jobs with Status Field / Permit Approved.
  dispatchJobs: adminProcedure.query(async () => {
    const jobs = await fetchDispatchJobs();
    return jobs.map(withZone);
  }),

  jobDetail: adminProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const job = await fetchJobById(input.jobId);
      const history = await listChangeHistory(input.jobId);
      return { job: withZone(job), history };
    }),

  technicians: adminProcedure.query(async () => {
    await seedTechnicians();
    return listTechnicians();
  }),

  // Assign or unassign technicians for a phase. Returns conflict info.
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
      const fieldName = PHASE_TO_FIELD[input.phase as JobPhase];
      const job = await fetchJobById(input.jobId);
      const targetInterval = jobToInterval(job);

      // Conflict detection: for each newly added technician, check overlap
      // with other dispatch jobs they're already on.
      const conflicts: {
        technician: string;
        otherJobId: string;
        otherJobLabel: string;
      }[] = [];

      if (targetInterval) {
        const allJobs = await fetchDispatchJobs();
        const previous = new Set(
          (input.phase === "Preparation"
            ? job.techPrep
            : input.phase === "Setup"
            ? job.techSetup
            : job.techPickup) ?? [],
        );
        const newlyAdded = input.technicians.filter((t) => !previous.has(t));

        for (const tech of newlyAdded) {
          const otherIntervals = allJobs
            .filter((j) => j.id !== job.id)
            .filter(
              (j) =>
                j.techPrep.includes(tech) ||
                j.techSetup.includes(tech) ||
                j.techPickup.includes(tech),
            )
            .map((j) => ({ job: j, iv: jobToInterval(j) }))
            .filter((x) => x.iv !== null);

          const res = detectConflicts(
            targetInterval,
            otherIntervals.map((x) => x.iv!),
          );
          if (res.hasConflict) {
            for (const c of res.conflicts) {
              const other = otherIntervals.find(
                (x) => x.iv!.jobId === c.otherJobId,
              );
              conflicts.push({
                technician: tech,
                otherJobId: c.otherJobId,
                otherJobLabel: other
                  ? `${other.job.company ?? "Job"} — ${other.job.jobAddress ?? ""}`
                  : c.otherJobId,
              });
            }
          }
        }
      }

      if (conflicts.length > 0 && !input.force) {
        return { ok: false as const, conflicts };
      }

      const oldValue =
        input.phase === "Preparation"
          ? job.techPrep
          : input.phase === "Setup"
          ? job.techSetup
          : job.techPickup;

      // Write to Airtable (authoritative).
      const updated = await updateJobFields(input.jobId, {
        [fieldName]: input.technicians,
      });

      // Immutable change history.
      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
        action: "assign_technician",
        fieldName,
        oldValue: JSON.stringify(oldValue),
        newValue: JSON.stringify(input.technicians),
        details: `Phase: ${input.phase}${conflicts.length ? " (forced over conflict)" : ""}`,
      });

      // Notifications: newly assigned techs.
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
      for (const t of Array.from(oldValue)) {
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

      return { ok: true as const, job: withZone(updated), conflicts };
    }),

  // Modify a job: extend/shorten end date and/or change sub-status.
  modifyJob: adminProcedure
    .input(
      z.object({
        jobId: z.string(),
        endDate: z.string().optional(), // ISO
        subStatus: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const job = await fetchJobById(input.jobId);
      const fields: Record<string, unknown> = {};
      const changes: { field: string; old: string; new: string }[] = [];

      if (input.endDate !== undefined) {
        fields[AF.endDate] = input.endDate;
        changes.push({
          field: AF.endDate,
          old: job.endDate ?? "",
          new: input.endDate,
        });
      }
      if (input.subStatus !== undefined) {
        fields[AF.subStatus] = input.subStatus;
        changes.push({
          field: AF.subStatus,
          old: job.subStatus ?? "",
          new: input.subStatus,
        });
      }

      if (Object.keys(fields).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No changes provided",
        });
      }

      const updated = await updateJobFields(input.jobId, fields);

      for (const c of changes) {
        await appendChangeHistory({
          airtableJobId: input.jobId,
          actorUserId: ctx.user.id,
          actorName: ctx.user.name ?? ctx.user.email ?? "Coordinator",
          action:
            c.field === AF.endDate ? "extend_end_date" : "change_sub_status",
          fieldName: c.field,
          oldValue: c.old,
          newValue: c.new,
          details: input.reason ?? null,
        });
      }

      // Notify all assigned techs of the modification.
      const assigned = new Set([
        ...job.techPrep,
        ...job.techSetup,
        ...job.techPickup,
      ]);
      const jobLabel = `${job.company ?? "Job"} — ${job.jobAddress ?? ""}`;
      for (const t of Array.from(assigned)) {
        await createNotification({
          technicianName: t,
          airtableJobId: input.jobId,
          type: "modified",
          title: "Job updated",
          body: jobLabel,
        });
      }

      return { ok: true as const, job: withZone(updated) };
    }),

  // Coordinator internal note (kept in change history, not the Airtable field).
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

      // Add live in-progress hours for currently checked-in techs.
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
});
