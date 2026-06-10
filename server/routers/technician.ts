import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { fetchJobById } from "../airtable";
import { JobRecord } from "../../shared/airtableFields";
import { deriveZone } from "../../shared/opsLogic";
import { storageGetSignedUrl, storagePut } from "../storage";
import {
  appendChangeHistory,
  closeTimeLog,
  countUnreadNotifications,
  createHazardAssessment,
  createJobNote,
  createJobPhoto,
  createTimeLog,
  getHazardAssessment,
  getJobOverride,
  getOpenTimeLog,
  getTechnicianByName,
  getTechnicianByUserId,
  linkTechnicianToUser,
  listJobIdsForTechnician,
  listJobNotes,
  listJobPhotos,
  listNotificationsForTechnician,
  listTechnicians,
  markAllNotificationsRead,
  markNotificationRead,
  seedTechnicians,
} from "../opsDb";

const phaseSchema = z.enum(["Preparation", "Setup", "Pickup"]);

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

    const results = [];
    for (const jobId of jobIds) {
      try {
        const job = await fetchJobById(jobId);
        const phases = byJob.get(jobId) ?? [];
        results.push(await buildMyJob(job, tech.airtableName, phases));
      } catch {
        // Skip jobs that can't be fetched from Airtable.
      }
    }
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
    .input(z.object({ jobId: z.string(), note: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const tech = await resolveTechnician(ctx.user.id);
      if (!tech)
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a technician" });

      await createJobNote({
        airtableJobId: input.jobId,
        authorName: tech.displayName,
        authorRole: "technician",
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
