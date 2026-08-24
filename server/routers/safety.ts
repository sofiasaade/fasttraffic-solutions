import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  activeForm,
  CONTROLLED_FORMS,
  VEHICLE_INSPECTION_SECTIONS,
} from "../../shared/safetyForms";
import {
  getStartWorkAuth,
  getSubmission,
  insertDefect,
  insertFormSubmission,
  insertStartWorkAuth,
  latestSubmission,
  listDefects,
  listOpenDefectsForUnit,
  listSubmissionsForTech,
  listSubmissionsForDate,
  listSubmissionsForJobs,
  listAuthsForDate,
  listAuthsForJob,
  releaseDefect,
  setDayStage,
} from "../safetyDb";
import {
  appendChangeHistory,
  createNotification,
  getDaySession,
  getHazardAssessment,
  getTechnicianByUserId,
  listDaySessions,
  listTechnicians,
} from "../opsDb";

function calgaryToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
}

async function requireTech(userId: number) {
  const tech = await getTechnicianByUserId(userId);
  if (!tech)
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a technician" });
  return tech;
}

/** Notify every active supervisor-ish user — v1: the coordinator inbox. */
async function notifySupervisor(title: string, body: string, jobId?: string) {
  // Coordinator sees these in Messages/Alerts; also notify every senior tech.
  const techs = await listTechnicians();
  const seniors = techs.filter(
    (t: any) => t.active !== false && t.experienceLevel === "senior",
  );
  for (const s of seniors.slice(0, 5)) {
    await createNotification({
      technicianName: s.airtableName,
      airtableJobId: jobId ?? null,
      type: "info",
      title,
      body,
    });
  }
}

const defectInput = z.object({
  category: z.string().min(1).max(64),
  itemKey: z.string().max(64).optional(),
  severity: z.enum(["minor", "major", "critical"]),
  description: z.string().min(1).max(2000),
  immediateAction: z.string().max(2000).optional(),
  taggedOut: z.boolean().optional(),
  supervisorNotified: z.boolean().optional(),
});

export const safetyRouter = router({
  /** Controlled-document register (form numbers, versions, effective dates). */
  forms: protectedProcedure.query(() => CONTROLLED_FORMS),

  /**
   * The technician's "My Day" state: session, stage timestamps, which daily
   * forms are done, open critical defects on their truck, and progress.
   */
  myDay: protectedProcedure.query(async ({ ctx }) => {
    const tech = await requireTech(ctx.user.id);
    const date = calgaryToday();
    const session = await getDaySession(tech.airtableName, date);
    const [sod, veh] = await Promise.all([
      latestSubmission(tech.airtableName, date, "FTS-APP-SOD"),
      latestSubmission(tech.airtableName, date, "FTS-APP-VEH"),
    ]);
    const truck = session?.truckName ?? null;
    const openDefects = truck ? await listOpenDefectsForUnit(truck) : [];
    const critical = openDefects.filter((d) => d.severity === "critical");
    return {
      date,
      session: session ?? null,
      startOfDayDone: !!sod,
      vehicleInspectionDone: !!veh,
      vehicleInspectionId: veh?.id ?? null,
      openDefects: openDefects.map((d) => ({
        id: d.id,
        refNumber: d.refNumber,
        severity: d.severity,
        category: d.category,
        description: d.description,
        status: d.status,
      })),
      doNotOperate: critical.length > 0,
      departedAt: session?.departWarehouseAt ?? null,
      arrivedAt: session?.arriveSiteAt ?? null,
      returnedAt: session?.returnWarehouseAt ?? null,
    };
  }),

  /**
   * Submit a controlled form. IMMUTABLE: rows are never updated or deleted;
   * corrections create a new submission with revisionOf + reason. Idempotent
   * on clientUuid (offline-sync duplicate protection).
   */
  submitForm: protectedProcedure
    .input(
      z.object({
        formNumber: z.string().min(1).max(32),
        jobId: z.string().max(32).nullable().optional(),
        unitName: z.string().max(128).nullable().optional(),
        answers: z.record(z.string(), z.any()),
        clientUuid: z.string().min(8).max(64),
        revisionOf: z.number().int().optional(),
        revisionReason: z.string().max(500).optional(),
        defects: z.array(defectInput).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tech = await requireTech(ctx.user.id);
      const form = activeForm(input.formNumber);
      if (!form)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown form number." });
      if (input.revisionOf && !input.revisionReason?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A correction requires a reason.",
        });
      }
      const date = calgaryToday();

      // Vehicle inspection: every REQUIRED item needs pass/defect/na —
      // "not inspected" cannot satisfy a required item.
      if (input.formNumber === "FTS-APP-VEH") {
        const answers = input.answers as Record<string, string>;
        for (const section of VEHICLE_INSPECTION_SECTIONS) {
          for (const item of section.items) {
            if (!item.required) continue;
            const v = answers[`${section.key}.${item.key}`];
            if (!v || v === "not_inspected") {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: `Required item not inspected: ${item.label}`,
              });
            }
          }
        }
        if (!input.unitName) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Vehicle inspection needs the unit (truck).",
          });
        }
      }

      const { row, duplicate } = await insertFormSubmission({
        formNumber: form.formNumber,
        formVersion: form.version,
        effectiveDate: form.effectiveDate,
        airtableJobId: input.jobId ?? null,
        technicianName: tech.airtableName,
        shiftDate: date,
        unitName: input.unitName ?? null,
        revisionOf: input.revisionOf ?? null,
        revisionReason: input.revisionReason ?? null,
        answersJson: JSON.stringify(input.answers),
        clientUuid: input.clientUuid,
      });

      // Register any defects raised by this submission.
      const refs: string[] = [];
      if (!duplicate && input.defects && input.defects.length > 0) {
        for (const def of input.defects) {
          const ref = await insertDefect({
            technicianName: tech.airtableName,
            date,
            unitType: "vehicle",
            unitName: input.unitName ?? "—",
            category: def.category,
            itemKey: def.itemKey ?? null,
            severity: def.severity,
            description: def.description,
            immediateAction: def.immediateAction ?? null,
            taggedOut: def.taggedOut ?? false,
            supervisorNotified: def.supervisorNotified ?? false,
            submissionId: row.id,
            status: "open",
          });
          refs.push(ref);
          if (def.severity === "critical") {
            await notifySupervisor(
              "🚨 CRITICAL defect — DO NOT OPERATE",
              `${input.unitName ?? "Unit"}: ${def.description} (${ref}, reported by ${tech.displayName})`,
            );
          }
        }
        await appendChangeHistory({
          airtableJobId: input.jobId ?? `__safety__:${date}`,
          actorUserId: ctx.user.id,
          actorName: tech.displayName,
          action: "form_submission",
          fieldName: `${form.formNumber} ${form.version}`,
          oldValue: null,
          newValue: `Submission #${row.id}`,
          details: refs.length ? `Defects: ${refs.join(", ")}` : null,
        });
      }
      return {
        ok: true as const,
        id: row.id,
        duplicate,
        defectRefs: refs,
        formNumber: form.formNumber,
        formVersion: form.version,
      };
    }),

  mySubmissions: protectedProcedure
    .input(z.object({ date: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const tech = await requireTech(ctx.user.id);
      const rows = await listSubmissionsForTech(tech.airtableName, input?.date);
      return rows.map((r) => ({
        id: r.id,
        formNumber: r.formNumber,
        formVersion: r.formVersion,
        shiftDate: r.shiftDate,
        jobId: r.airtableJobId,
        unitName: r.unitName,
        status: r.status,
        revisionOf: r.revisionOf,
        submittedAt: r.submittedAt,
      }));
    }),

  /** Ad-hoc defect report (during-shift quick action). */
  reportDefect: protectedProcedure
    .input(
      defectInput.extend({
        unitName: z.string().min(1).max(128),
        unitType: z.enum(["vehicle", "trailer", "equipment"]).default("vehicle"),
        jobId: z.string().max(32).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tech = await requireTech(ctx.user.id);
      const ref = await insertDefect({
        technicianName: tech.airtableName,
        date: calgaryToday(),
        unitType: input.unitType,
        unitName: input.unitName,
        category: input.category,
        severity: input.severity,
        description: input.description,
        immediateAction: input.immediateAction ?? null,
        taggedOut: input.taggedOut ?? false,
        supervisorNotified: input.supervisorNotified ?? false,
        status: "open",
      });
      if (input.severity === "critical") {
        await notifySupervisor(
          "🚨 CRITICAL defect — DO NOT OPERATE",
          `${input.unitName}: ${input.description} (${ref}, reported by ${tech.displayName})`,
          input.jobId,
        );
      }
      return { ok: true as const, refNumber: ref };
    }),

  /** Defect register (coordinator sees all; techs see their own unit's). */
  defects: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return listDefects(input?.status);
    }),

  /** Authorized release of a defect — coordinator (admin) only. */
  releaseDefect: protectedProcedure
    .input(z.object({ id: z.number().int(), actionTaken: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the coordinator can release a defect.",
        });
      }
      await releaseDefect(input.id, ctx.user.name ?? "Coordinator", input.actionTaken);
      return { ok: true as const };
    }),

  /** Daily workflow stage transitions. */
  departWarehouse: protectedProcedure.mutation(async ({ ctx }) => {
    const tech = await requireTech(ctx.user.id);
    const date = calgaryToday();
    const session = await getDaySession(tech.airtableName, date);
    if (!session)
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Check in first (Start Day)." });
    const [sod, veh] = await Promise.all([
      latestSubmission(tech.airtableName, date, "FTS-APP-SOD"),
      latestSubmission(tech.airtableName, date, "FTS-APP-VEH"),
    ]);
    if (!sod)
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Start-of-day confirmation required." });
    if (!veh)
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Vehicle inspection required." });
    const critical = session.truckName
      ? (await listOpenDefectsForUnit(session.truckName)).filter((d) => d.severity === "critical")
      : [];
    if (critical.length > 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `DO NOT OPERATE — ${session.truckName} has a critical defect (${critical[0].refNumber}).`,
      });
    }
    await setDayStage(tech.airtableName, date, "departWarehouseAt");
    return { ok: true as const };
  }),

  arriveSite: protectedProcedure.mutation(async ({ ctx }) => {
    const tech = await requireTech(ctx.user.id);
    await setDayStage(tech.airtableName, calgaryToday(), "arriveSiteAt");
    return { ok: true as const };
  }),

  returnWarehouse: protectedProcedure.mutation(async ({ ctx }) => {
    const tech = await requireTech(ctx.user.id);
    await setDayStage(tech.airtableName, calgaryToday(), "returnWarehouseAt");
    return { ok: true as const };
  }),

  /**
   * "START WORK — SAFE TO PROCEED" gate for a job. Returns each requirement's
   * state; authorize() only succeeds when EVERY one passes.
   */
  startWorkStatus: protectedProcedure
    .input(z.object({ jobId: z.string(), phase: z.string().default("Setup") }))
    .query(async ({ ctx, input }) => {
      const tech = await requireTech(ctx.user.id);
      const date = calgaryToday();
      const session = await getDaySession(tech.airtableName, date);
      const [sod, veh, hazard, auth] = await Promise.all([
        latestSubmission(tech.airtableName, date, "FTS-APP-SOD"),
        latestSubmission(tech.airtableName, date, "FTS-APP-VEH"),
        getHazardAssessment(input.jobId, tech.airtableName, input.phase as any),
        getStartWorkAuth(tech.airtableName, date, input.jobId),
      ]);
      const critical = session?.truckName
        ? (await listOpenDefectsForUnit(session.truckName)).filter((d) => d.severity === "critical")
        : [];
      const requirements = [
        { key: "day", label: "Day started (warehouse check-in)", ok: !!session },
        { key: "sod", label: "Start-of-day confirmation", ok: !!sod },
        { key: "vehicle", label: "Vehicle pre-use inspection", ok: !!veh },
        { key: "no_critical", label: "No critical defects on your vehicle", ok: critical.length === 0 },
        { key: "hazard", label: "Site hazard assessment", ok: !!hazard },
      ];
      return {
        authorized: !!auth,
        authorizedAt: auth?.authorizedAt ?? null,
        canStart: requirements.every((r) => r.ok),
        requirements,
      };
    }),

  authorizeStartWork: protectedProcedure
    .input(z.object({ jobId: z.string(), phase: z.string().default("Setup") }))
    .mutation(async ({ ctx, input }) => {
      const tech = await requireTech(ctx.user.id);
      const date = calgaryToday();
      const existing = await getStartWorkAuth(tech.airtableName, date, input.jobId);
      if (existing) return { ok: true as const, already: true };
      const session = await getDaySession(tech.airtableName, date);
      const [sod, veh, hazard] = await Promise.all([
        latestSubmission(tech.airtableName, date, "FTS-APP-SOD"),
        latestSubmission(tech.airtableName, date, "FTS-APP-VEH"),
        getHazardAssessment(input.jobId, tech.airtableName, input.phase as any),
      ]);
      const critical = session?.truckName
        ? (await listOpenDefectsForUnit(session.truckName)).filter((d) => d.severity === "critical")
        : [];
      const blockers: string[] = [];
      if (!session) blockers.push("Day not started");
      if (!sod) blockers.push("Start-of-day confirmation missing");
      if (!veh) blockers.push("Vehicle inspection missing");
      if (critical.length > 0)
        blockers.push(`Critical defect open (${critical.map((c) => c.refNumber).join(", ")})`);
      if (!hazard) blockers.push("Hazard assessment missing");
      if (blockers.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot start work: ${blockers.join(" · ")}`,
        });
      }
      await insertStartWorkAuth({
        airtableJobId: input.jobId,
        technicianName: tech.airtableName,
        date,
        snapshotJson: JSON.stringify({
          phase: input.phase,
          sodSubmissionId: sod!.id,
          vehSubmissionId: veh!.id,
          hazardId: hazard!.id,
          truck: session!.truckName,
          verifiedAt: new Date().toISOString(),
        }),
      });
      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: tech.displayName,
        action: "start_work_authorized",
        fieldName: date,
        oldValue: null,
        newValue: "SAFE TO PROCEED",
        details: `Phase ${input.phase} · truck ${session!.truckName ?? "—"}`,
      });
      return { ok: true as const, already: false };
    }),

  /* ------------------- Coordinator safety reports (admin) ------------------- */

  /**
   * Daily compliance report: one row per technician who worked the date —
   * check-in/out, truck, daily forms, stages, start-work authorizations and
   * defects raised. Exceptions (missing forms) are computed per row.
   */
  dayReport: adminProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const [sessions, subs, auths, defects] = await Promise.all([
        listDaySessions(input.date),
        listSubmissionsForDate(input.date),
        listAuthsForDate(input.date),
        listDefects(),
      ]);
      const dayDefects = defects.filter((d) => d.date === input.date);
      const rows = sessions.map((s) => {
        const mine = subs.filter((x) => x.technicianName === s.technicianName);
        const sod = mine.find((x) => x.formNumber === "FTS-APP-SOD");
        const veh = mine.find((x) => x.formNumber === "FTS-APP-VEH");
        const myAuths = auths.filter((a) => a.technicianName === s.technicianName);
        const myDefects = dayDefects.filter(
          (d) => d.technicianName === s.technicianName,
        );
        const exceptions: string[] = [];
        if (!sod) exceptions.push("Start-of-day missing");
        if (!veh) exceptions.push("Vehicle inspection missing");
        if (myDefects.some((d) => d.severity === "critical" && d.status === "open"))
          exceptions.push("CRITICAL defect open");
        return {
          technicianName: s.technicianName,
          truck: s.truckName,
          checkInAt: s.checkInAt,
          checkOutAt: s.checkOutAt,
          departWarehouseAt: (s as any).departWarehouseAt ?? null,
          arriveSiteAt: (s as any).arriveSiteAt ?? null,
          returnWarehouseAt: (s as any).returnWarehouseAt ?? null,
          startOfDay: sod ? { id: sod.id, at: sod.submittedAt } : null,
          vehicleInspection: veh
            ? { id: veh.id, at: veh.submittedAt, unit: veh.unitName }
            : null,
          startWorkJobs: myAuths.map((a) => ({
            jobId: a.airtableJobId,
            at: a.authorizedAt,
          })),
          defects: myDefects.map((d) => ({
            id: d.id,
            refNumber: d.refNumber,
            severity: d.severity,
            unitName: d.unitName,
            status: d.status,
            description: d.description,
          })),
          exceptions,
        };
      });
      return { date: input.date, rows };
    }),

  /** Project safety package: every safety record tied to one job. */
  jobPackage: adminProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const [subs, auths] = await Promise.all([
        listSubmissionsForJobs([input.jobId]),
        listAuthsForJob(input.jobId),
      ]);
      return {
        submissions: subs.map((s) => ({
          id: s.id,
          formNumber: s.formNumber,
          formVersion: s.formVersion,
          technicianName: s.technicianName,
          shiftDate: s.shiftDate,
          unitName: s.unitName,
          status: s.status,
          revisionOf: s.revisionOf,
          submittedAt: s.submittedAt,
        })),
        startWork: auths.map((a) => ({
          technicianName: a.technicianName,
          date: a.date,
          at: a.authorizedAt,
        })),
      };
    }),

  /** Full historical copy of one submission (coordinator viewer). */
  submissionDetail: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const s = await getSubmission(input.id);
      if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      return { ...s, answers: JSON.parse(s.answersJson) };
    }),
});
