import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  appendAttachments,
  appendToTextField,
  fetchJobById,
  fetchJobsForTechnician,
} from "../airtable";
import { AF } from "../../shared/airtableFields";
import { deriveZone } from "../../shared/opsLogic";
import { storageGetSignedUrl, storagePut } from "../storage";
import {
  appendChangeHistory,
  closeTimeLog,
  countUnreadNotifications,
  createHazardAssessment,
  createTimeLog,
  getHazardAssessment,
  getOpenTimeLog,
  getTechnicianByName,
  getTechnicianByUserId,
  linkTechnicianToUser,
  listNotificationsForTechnician,
  listTechnicians,
  markAllNotificationsRead,
  markNotificationRead,
  seedTechnicians,
} from "../opsDb";

const phaseSchema = z.enum(["Preparation", "Setup", "Pickup"]);

// Resolve the technician identity for the logged-in user.
async function resolveTechnician(userId: number) {
  return getTechnicianByUserId(userId);
}

function withZone(job: any) {
  return { ...job, zone: deriveZone(job) };
}

export const technicianRouter = router({
  // Returns the technician profile linked to the current user (or null).
  me: protectedProcedure.query(async ({ ctx }) => {
    const tech = await resolveTechnician(ctx.user.id);
    return tech ?? null;
  }),

  // List of all technician names so a user can self-identify on first login.
  roster: protectedProcedure.query(async () => {
    await seedTechnicians();
    return listTechnicians();
  }),

  // Link the current user account to a technician identity.
  claimIdentity: protectedProcedure
    .input(z.object({ airtableName: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tech = await getTechnicianByName(input.airtableName);
      if (!tech)
        throw new TRPCError({ code: "NOT_FOUND", message: "Technician not found" });
      await linkTechnicianToUser(input.airtableName, ctx.user.id);
      return { ok: true as const };
    }),

  // Jobs assigned to me (any phase).
  myJobs: protectedProcedure.query(async ({ ctx }) => {
    const tech = await resolveTechnician(ctx.user.id);
    if (!tech) return [];
    const jobs = await fetchJobsForTechnician(tech.airtableName);

    return jobs.map((job) => {
      const phases: string[] = [];
      if (job.techPrep.includes(tech.airtableName)) phases.push("Preparation");
      if (job.techSetup.includes(tech.airtableName)) phases.push("Setup");
      if (job.techPickup.includes(tech.airtableName)) phases.push("Pickup");
      return { ...withZone(job), myPhases: phases };
    });
  }),

  // Status for a single job: hazard done? open time log?
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

  // Submit hazard assessment (hard gate for check-in).
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

  // Check in — BLOCKED unless hazard assessment exists for (job, tech, phase).
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
      const hours =
        (checkOutAt.getTime() - checkInAt.getTime()) / (3600 * 1000);
      await closeTimeLog(open.id, checkOutAt, Math.round(hours * 100) / 100);
      return { ok: true as const, hours: Math.round(hours * 100) / 100 };
    }),

  // Upload a field photo (before/during/after) -> Airtable Field Photos.
  uploadPhoto: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        category: z.enum(["before", "during", "after"]),
        // base64 data URL or raw base64
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

      // Airtable must fetch the file from a public URL. Use a presigned GET URL.
      const absoluteUrl = await storageGetSignedUrl(stored.key);

      await appendAttachments(input.jobId, AF.fieldPhotos, [
        { url: absoluteUrl, filename: `${input.category}_${filename}` },
      ]);

      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: tech.displayName,
        action: "field_photo",
        fieldName: AF.fieldPhotos,
        oldValue: null,
        newValue: filename,
        details: `Category: ${input.category}`,
      });

      return { ok: true as const, url: absoluteUrl };
    }),

  // Add a field note -> Airtable Field Commnets, timestamped.
  addFieldNote: protectedProcedure
    .input(z.object({ jobId: z.string(), note: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const tech = await resolveTechnician(ctx.user.id);
      if (!tech)
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a technician" });
      const stamp = new Date().toLocaleString("en-CA", {
        timeZone: "America/Edmonton",
      });
      const line = `[${stamp}] ${tech.displayName}: ${input.note}`;
      await appendToTextField(input.jobId, AF.fieldComments, line);

      await appendChangeHistory({
        airtableJobId: input.jobId,
        actorUserId: ctx.user.id,
        actorName: tech.displayName,
        action: "field_note",
        fieldName: AF.fieldComments,
        oldValue: null,
        newValue: input.note,
        details: null,
      });
      return { ok: true as const };
    }),

  // Notifications
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
