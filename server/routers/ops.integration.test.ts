import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration tests for the core safety/operations rules.
 *
 * Airtable is READ-ONLY: assignments, photos, notes, and job overrides live in
 * the local DB. These tests mock the Airtable read layer and the opsDb layer
 * (with an in-memory store) and assert that no Airtable WRITE ever happens.
 */

// ---- Mock state ----
const state = {
  hazard: null as any,
  openTimeLog: null as any,
  changeHistory: [] as any[],
  notifications: [] as any[],
  jobs: {} as Record<string, any>,
  dispatchJobs: [] as any[],
  mapJobs: null as any[] | null,
  technicians: [] as any[],
  // Local store
  assignments: [] as { airtableJobId: string; phase: string; technicianName: string }[],
  overrides: {} as Record<string, { endDate: string | null; subStatus: string | null }>,
  photos: [] as any[],
  notes: [] as any[],
  billingNotes: [] as any[],
  billingSeq: 0,
  // Day-pinned scheduler assignments (local).
  scheduled: [] as {
    id: number;
    airtableJobId: string;
    phase: string;
    technicianName: string;
    scheduledDate: string;
    startTime: string | null;
    endTime: string | null;
  }[],
  scheduledSeq: 0,
  // Equipment catalog + day-pinned equipment placements (local).
  equipmentCatalog: [] as any[],
  equipment: [] as {
    id: number;
    airtableJobId: string;
    equipmentName: string;
    scheduledDate: string;
    technicianName: string | null;
    quantity: number;
    notes: string | null;
  }[],
  equipmentSeq: 0,
  // Truck catalog + day-pinned truck assignments (local).
  truckCatalog: [] as any[],
  trucks: [] as {
    id: number;
    airtableJobId: string;
    truckName: string;
    scheduledDate: string;
    driverName: string | null;
    notes: string | null;
  }[],
  truckSeq: 0,
  // Any of these being > 0 means a read-only violation occurred.
  airtableWriteCalls: [] as { fn: string; id: string }[],
};

function makeJob(over: Partial<any> = {}) {
  return {
    id: "recJOB1",
    company: "Acme",
    jobAddress: "123 Main St, Calgary",
    projectTitle: null,
    startDate: "2026-06-15",
    endDate: "2026-06-15",
    setupDuration: "Daily Set Up (9:00 AM - 3:00 PM)",
    status: "Field",
    subStatus: null,
    requestId: null,
    municipality: "Calgary",
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
    ...over,
  };
}

// ---- Mock Airtable (reads work; writes record a violation) ----
vi.mock("../airtable", () => ({
  fetchJobById: vi.fn(async (id: string) => state.jobs[id] ?? makeJob({ id })),
  fetchDispatchJobs: vi.fn(async () => state.dispatchJobs),
  fetchMapJobs: vi.fn(async () => state.mapJobs ?? state.dispatchJobs),
  fetchJobsForTechnician: vi.fn(async () => state.dispatchJobs),
  updateJobFields: vi.fn(async (id: string) => {
    state.airtableWriteCalls.push({ fn: "updateJobFields", id });
    throw new Error("READ-ONLY violation: updateJobFields called");
  }),
  appendToTextField: vi.fn(async (id: string) => {
    state.airtableWriteCalls.push({ fn: "appendToTextField", id });
    throw new Error("READ-ONLY violation: appendToTextField called");
  }),
  appendAttachments: vi.fn(async (id: string) => {
    state.airtableWriteCalls.push({ fn: "appendAttachments", id });
    throw new Error("READ-ONLY violation: appendAttachments called");
  }),
}));

// ---- Mock opsDb (in-memory local store) ----
vi.mock("../opsDb", () => ({
  getHazardAssessment: vi.fn(async () => state.hazard),
  getOpenTimeLog: vi.fn(async () => state.openTimeLog),
  createTimeLog: vi.fn(async () => 1),
  closeTimeLog: vi.fn(async () => {}),
  createHazardAssessment: vi.fn(async (h: any) => {
    state.hazard = { id: 1, ...h };
    return 1;
  }),
  appendChangeHistory: vi.fn(async (entry: any) => {
    state.changeHistory.push({
      id: state.changeHistory.length + 1,
      createdAt: new Date(),
      ...entry,
    });
    return state.changeHistory.length;
  }),
  listChangeHistory: vi.fn(async () => state.changeHistory),
  listAllChangeHistory: vi.fn(async () => state.changeHistory),
  createNotification: vi.fn(async (n: any) => {
    state.notifications.push(n);
    return state.notifications.length;
  }),
  listTechnicians: vi.fn(async () => state.technicians),
  seedTechnicians: vi.fn(async () => {}),
  setTechnicianLevel: vi.fn(async (airtableName: string, level: "junior" | "senior") => {
    const t = state.technicians.find((x: any) => x.airtableName === airtableName);
    if (t) t.experienceLevel = level;
  }),
  getTechnicianByUserId: vi.fn(async () => ({
    id: 1,
    airtableName: "Hector",
    displayName: "Hector",
    userId: 7,
    phone: null,
    zones: null,
    active: true,
  })),
  getTechnicianByName: vi.fn(async () => ({
    id: 1,
    airtableName: "Hector",
    displayName: "Hector",
  })),
  linkTechnicianToUser: vi.fn(async () => {}),
  getOvertimeThreshold: vi.fn(async () => 44),
  sumHoursInPeriod: vi.fn(async () => []),
  listOpenTimeLogs: vi.fn(async () => []),
  setSetting: vi.fn(async () => {}),

  // Local assignments
  listAssignmentsForJob: vi.fn(async (jobId: string) =>
    state.assignments.filter((a) => a.airtableJobId === jobId),
  ),
  getAssignmentsMap: vi.fn(async (ids: string[]) => {
    const map = new Map<string, { Preparation: string[]; Setup: string[]; Pickup: string[] }>();
    for (const a of state.assignments) {
      if (!ids.includes(a.airtableJobId)) continue;
      if (!map.has(a.airtableJobId))
        map.set(a.airtableJobId, { Preparation: [], Setup: [], Pickup: [] });
      (map.get(a.airtableJobId) as any)[a.phase].push(a.technicianName);
    }
    return map;
  }),
  setPhaseAssignments: vi.fn(
    async (jobId: string, phase: string, techs: string[]) => {
      const old = state.assignments
        .filter((a) => a.airtableJobId === jobId && a.phase === phase)
        .map((a) => a.technicianName);
      state.assignments = state.assignments.filter(
        (a) => !(a.airtableJobId === jobId && a.phase === phase),
      );
      for (const t of techs)
        state.assignments.push({ airtableJobId: jobId, phase, technicianName: t });
      return old;
    },
  ),
  listAllAssignmentsForTechnician: vi.fn(async (name: string) =>
    state.assignments.filter((a) => a.technicianName === name),
  ),
  listJobIdsForTechnician: vi.fn(async (name: string) => {
    const byJob = new Map<string, string[]>();
    for (const a of state.assignments) {
      if (a.technicianName !== name) continue;
      if (!byJob.has(a.airtableJobId)) byJob.set(a.airtableJobId, []);
      byJob.get(a.airtableJobId)!.push(a.phase);
    }
    return byJob;
  }),

  // Local overrides
  upsertJobOverride: vi.fn(async (jobId: string, patch: any) => {
    const prev = state.overrides[jobId] ?? { endDate: null, subStatus: null };
    state.overrides[jobId] = {
      endDate: patch.endDate !== undefined ? patch.endDate : prev.endDate,
      subStatus: patch.subStatus !== undefined ? patch.subStatus : prev.subStatus,
    };
  }),
  getJobOverride: vi.fn(async (jobId: string) => state.overrides[jobId] ?? undefined),
  getJobOverridesMap: vi.fn(async (ids: string[]) => {
    const map = new Map<string, any>();
    for (const id of ids) if (state.overrides[id]) map.set(id, state.overrides[id]);
    return map;
  }),

  // Local photos / notes
  createJobPhoto: vi.fn(async (p: any) => {
    state.photos.push(p);
  }),
  listJobPhotos: vi.fn(async (jobId: string) =>
    state.photos.filter((p) => p.airtableJobId === jobId),
  ),
  createJobNote: vi.fn(async (n: any) => {
    state.notes.push({ ...n, createdAt: new Date() });
  }),
  listJobNotes: vi.fn(async (jobId: string) =>
    state.notes.filter((n) => n.airtableJobId === jobId),
  ),

  // Day & time-specific scheduling (local)
  setScheduledAssignment: vi.fn(async (input: any) => {
    const existing = state.scheduled.find(
      (r) =>
        r.airtableJobId === input.airtableJobId &&
        r.phase === input.phase &&
        r.technicianName === input.technicianName &&
        r.scheduledDate === input.scheduledDate,
    );
    if (existing) {
      existing.startTime = input.startTime ?? null;
      existing.endTime = input.endTime ?? null;
      return existing.id;
    }
    const id = ++state.scheduledSeq;
    state.scheduled.push({
      id,
      airtableJobId: input.airtableJobId,
      phase: input.phase,
      technicianName: input.technicianName,
      scheduledDate: input.scheduledDate,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
    });
    return id;
  }),
  listScheduledAssignmentsForWeek: vi.fn(async (start: string, end: string) =>
    state.scheduled.filter(
      (r) => r.scheduledDate >= start && r.scheduledDate <= end,
    ),
  ),
  removeAssignment: vi.fn(async (id: number) => {
    state.scheduled = state.scheduled.filter((r) => r.id !== id);
  }),
  listBookedTechniciansOnDate: vi.fn(async (date: string) =>
    Array.from(
      new Set(
        state.scheduled
          .filter((r) => r.scheduledDate === date)
          .map((r) => r.technicianName),
      ),
    ),
  ),

  // Equipment catalog + assignments (local)
  seedEquipmentCatalog: vi.fn(async () => {
    state.equipmentCatalog = [
      { id: 1, name: "No Parking Signs", category: "Signs", color: "#ea580c", active: true },
      { id: 2, name: "Barricades", category: "Barriers", color: "#2563eb", active: true },
    ];
  }),
  listEquipmentCatalog: vi.fn(async () => state.equipmentCatalog),
  createEquipmentItem: vi.fn(async () => {}),
  setEquipmentAssignment: vi.fn(async (input: any) => {
    const id = ++state.equipmentSeq;
    state.equipment.push({
      id,
      airtableJobId: input.airtableJobId,
      equipmentName: input.equipmentName,
      scheduledDate: input.scheduledDate,
      technicianName: input.technicianName ?? null,
      quantity: input.quantity ?? 1,
      notes: input.notes ?? null,
    });
    return id;
  }),
  listEquipmentAssignmentsForWeek: vi.fn(async (start: string, end: string) =>
    state.equipment.filter(
      (r) => r.scheduledDate >= start && r.scheduledDate <= end,
    ),
  ),
  removeEquipmentAssignment: vi.fn(async (id: number) => {
    state.equipment = state.equipment.filter((r) => r.id !== id);
  }),
  // Truck catalog + assignments (local)
  seedTruckCatalog: vi.fn(async () => {
    state.truckCatalog = [
      {
        id: 1,
        name: "F 14",
        code: "FTS-01-0004",
        ref: "F 14",
        description: "Ford TRUCK/VAN F350 White - Gas 2015",
        vin: "1FDRF3G66FEC93606",
        plate: "CJR9273",
        color: "#2563eb",
        active: true,
      },
      {
        id: 2,
        name: "FC",
        code: "FTS-01-0011",
        ref: "FC",
        description: "2023 FORD F150 LARIAT SUPERCREW 4WD",
        vin: "1FTEW1EP5PKF51474",
        plate: "CSV3273",
        color: "#65a30d",
        active: true,
      },
    ];
  }),
  listTruckCatalog: vi.fn(async () => state.truckCatalog),
  setTruckAssignment: vi.fn(async (input: any) => {
    const id = ++state.truckSeq;
    state.trucks.push({
      id,
      airtableJobId: input.airtableJobId,
      truckName: input.truckName,
      scheduledDate: input.scheduledDate,
      driverName: input.driverName ?? null,
      notes: input.notes ?? null,
    });
    return id;
  }),
  listTruckAssignmentsForWeek: vi.fn(async (start: string, end: string) =>
    state.trucks.filter(
      (r) => r.scheduledDate >= start && r.scheduledDate <= end,
    ),
  ),
  removeTruckAssignment: vi.fn(async (id: number) => {
    state.trucks = state.trucks.filter((r) => r.id !== id);
  }),
  createBillingNote: vi.fn(async (n: any) => {
    const id = ++state.billingSeq;
    state.billingNotes.push({ id, ...n, createdAt: new Date() });
    return id;
  }),
  listBillingNotes: vi.fn(async (jobId: string) =>
    state.billingNotes
      .filter((n) => n.airtableJobId === jobId)
      .sort((a, b) => b.id - a.id),
  ),
  getBillingNoteCounts: vi.fn(async (ids: string[]) => {
    const map: Record<string, number> = {};
    for (const n of state.billingNotes) {
      if (ids.includes(n.airtableJobId))
        map[n.airtableJobId] = (map[n.airtableJobId] ?? 0) + 1;
    }
    return map;
  }),
  deleteBillingNote: vi.fn(async (id: number, authorUserId?: number) => {
    state.billingNotes = state.billingNotes.filter(
      (n) => !(n.id === id && (authorUserId == null || n.authorUserId === authorUserId)),
    );
  }),
}));

import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function adminCtx(): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "coord",
      email: "c@x.com",
      name: "Coordinator",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  } as TrpcContext;
}

function techCtx(): TrpcContext {
  const c = adminCtx();
  (c.user as any).role = "user";
  return c;
}

beforeEach(() => {
  state.hazard = null;
  state.openTimeLog = null;
  state.changeHistory = [];
  state.notifications = [];
  state.jobs = { recJOB1: makeJob() };
  state.dispatchJobs = [makeJob()];
  state.mapJobs = null;
  state.technicians = [
    { id: 1, airtableName: "Hector", displayName: "Hector", userId: 7, phone: null, zones: null, experienceLevel: "junior", active: true },
  ];
  state.assignments = [];
  state.overrides = {};
  state.photos = [];
  state.notes = [];
  state.billingNotes = [];
  state.billingSeq = 0;
  state.scheduled = [];
  state.scheduledSeq = 0;
  state.equipmentCatalog = [];
  state.equipment = [];
  state.equipmentSeq = 0;
  state.truckCatalog = [];
  state.trucks = [];
  state.truckSeq = 0;
  state.airtableWriteCalls = [];
});

describe("Hazard Assessment hard gate", () => {
  it("blocks check-in when no hazard assessment exists", async () => {
    const caller = appRouter.createCaller(techCtx());
    await expect(
      caller.technician.checkIn({ jobId: "recJOB1", phase: "Setup" }),
    ).rejects.toThrowError(/Hazard Assessment required/i);
  });

  it("allows check-in after a hazard assessment is submitted", async () => {
    const caller = appRouter.createCaller(techCtx());
    await caller.technician.submitHazard({
      jobId: "recJOB1",
      phase: "Setup",
      answers: { a: true },
      ppeConfirmed: true,
      signature: "Hector",
    });
    const res = await caller.technician.checkIn({ jobId: "recJOB1", phase: "Setup" });
    expect(res.ok).toBe(true);
  });
});

describe("Assignment conflict detection (local store)", () => {
  it("blocks a double-booking unless forced", async () => {
    // Hector is already assigned to an overlapping job locally.
    state.jobs["recJOB2"] = makeJob({
      id: "recJOB2",
      company: "Other",
      startDate: "2026-06-15",
      endDate: "2026-06-15",
    });
    state.assignments.push({
      airtableJobId: "recJOB2",
      phase: "Setup",
      technicianName: "Hector",
    });

    const caller = appRouter.createCaller(adminCtx());
    const res = await caller.coordinator.assignTechnicians({
      jobId: "recJOB1",
      phase: "Setup",
      technicians: ["Hector"],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.conflicts.length).toBeGreaterThan(0);
      expect(res.conflicts[0].technician).toBe("Hector");
    }
    // Nothing should have been persisted to recJOB1 on a blocked assignment.
    expect(
      state.assignments.filter((a) => a.airtableJobId === "recJOB1").length,
    ).toBe(0);
    expect(state.airtableWriteCalls.length).toBe(0);
  });

  it("writes the assignment LOCALLY when forced over a conflict (no Airtable write)", async () => {
    state.jobs["recJOB2"] = makeJob({ id: "recJOB2" });
    state.assignments.push({
      airtableJobId: "recJOB2",
      phase: "Setup",
      technicianName: "Hector",
    });

    const caller = appRouter.createCaller(adminCtx());
    const res = await caller.coordinator.assignTechnicians({
      jobId: "recJOB1",
      phase: "Setup",
      technicians: ["Hector"],
      force: true,
    });
    expect(res.ok).toBe(true);
    // Persisted locally.
    const local = state.assignments.filter((a) => a.airtableJobId === "recJOB1");
    expect(local.map((a) => a.technicianName)).toEqual(["Hector"]);
    // The returned merged job reflects the local assignment.
    if (res.ok) expect(res.job.techSetup).toEqual(["Hector"]);
    // No Airtable write.
    expect(state.airtableWriteCalls.length).toBe(0);
  });
});

describe("Permit map view", () => {
  it("returns Field, Permit Approved, and Permit Request Submitted jobs with coordinates and status", async () => {
    state.mapJobs = [
      makeJob({ id: "recFIELD", status: "Field", lat: 51.04, lon: -114.06 }),
      makeJob({
        id: "recPERMIT",
        company: "Permit Co",
        status: "Permit Approved",
        lat: 51.05,
        lon: -114.07,
      }),
      makeJob({
        id: "recSUBMITTED",
        company: "Submitted Co",
        status: "Permit Request Submitted",
        lat: 51.06,
        lon: -114.08,
      }),
    ];
    const caller = appRouter.createCaller(adminCtx());
    const res = await caller.coordinator.mapJobs();
    expect(res.length).toBe(3);
    const byId = Object.fromEntries(res.map((r) => [r.id, r]));
    expect(byId["recFIELD"].status).toBe("Field");
    expect(byId["recPERMIT"].status).toBe("Permit Approved");
    expect(byId["recSUBMITTED"].status).toBe("Permit Request Submitted");
    expect(byId["recFIELD"].lat).toBe(51.04);
    expect(byId["recFIELD"].zone).toBeTruthy();
  });
});

describe("Local job overrides via modifyJob", () => {
  it("stores end-date change locally and reflects it on the board (no Airtable write)", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await caller.coordinator.modifyJob({
      jobId: "recJOB1",
      endDate: "2026-06-20",
      reason: "Client extended",
    });
    expect(state.overrides["recJOB1"].endDate).toBe("2026-06-20");
    expect(state.airtableWriteCalls.length).toBe(0);

    const board = await caller.coordinator.boardJobs();
    const job = board.find((j) => j.id === "recJOB1");
    expect(job?.endDate).toBe("2026-06-20");
  });
});

describe("Technician field notes & photos are local", () => {
  it("stores a field note locally and surfaces it via myJobs (no Airtable write)", async () => {
    // Hector is assigned to recJOB1 so it appears in myJobs.
    state.assignments.push({
      airtableJobId: "recJOB1",
      phase: "Setup",
      technicianName: "Hector",
    });
    const caller = appRouter.createCaller(techCtx());
    await caller.technician.addFieldNote({ jobId: "recJOB1", note: "Cones placed" });
    expect(state.notes.length).toBe(1);
    expect(state.airtableWriteCalls.length).toBe(0);

    const jobs = await caller.technician.myJobs();
    const job = jobs.find((j) => j.id === "recJOB1");
    expect(job?.fieldComments).toContain("Cones placed");
  });
});

describe("Day & time scheduler (local, no Airtable write)", () => {
  it("persists a day/time-pinned assignment and lists it for the week", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const res = await caller.coordinator.setScheduled({
      jobId: "recJOB1",
      phase: "Setup",
      technicianName: "Hector",
      scheduledDate: "2026-06-16",
      startTime: "08:00",
      endTime: "16:00",
    });
    expect(res.ok).toBe(true);
    expect(state.scheduled.length).toBe(1);
    expect(state.airtableWriteCalls.length).toBe(0);

    const week = await caller.coordinator.scheduledAssignments({
      startDate: "2026-06-15",
      endDate: "2026-06-21",
    });
    expect(week.length).toBe(1);
    expect(week[0].technicianName).toBe("Hector");
    expect(week[0].scheduledDate).toBe("2026-06-16");
    expect(week[0].startTime).toBe("08:00");
  });

  it("blocks scheduling a worker already booked that day on another job unless forced", async () => {
    state.jobs["recJOB2"] = makeJob({ id: "recJOB2", company: "Other" });
    state.scheduled.push({
      id: ++state.scheduledSeq,
      airtableJobId: "recJOB2",
      phase: "Setup",
      technicianName: "Hector",
      scheduledDate: "2026-06-16",
      startTime: null,
      endTime: null,
    });
    const caller = appRouter.createCaller(adminCtx());
    const blocked = await caller.coordinator.setScheduled({
      jobId: "recJOB1",
      phase: "Setup",
      technicianName: "Hector",
      scheduledDate: "2026-06-16",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.conflicts[0].technician).toBe("Hector");
    // Not persisted for recJOB1.
    expect(
      state.scheduled.filter((r) => r.airtableJobId === "recJOB1").length,
    ).toBe(0);

    const forced = await caller.coordinator.setScheduled({
      jobId: "recJOB1",
      phase: "Setup",
      technicianName: "Hector",
      scheduledDate: "2026-06-16",
      force: true,
    });
    expect(forced.ok).toBe(true);
    expect(
      state.scheduled.filter((r) => r.airtableJobId === "recJOB1").length,
    ).toBe(1);
    expect(state.airtableWriteCalls.length).toBe(0);
  });

  it("removes a scheduled assignment by id", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const res = await caller.coordinator.setScheduled({
      jobId: "recJOB1",
      phase: "Pickup",
      technicianName: "Hector",
      scheduledDate: "2026-06-17",
    });
    expect(res.ok).toBe(true);
    const id = res.ok ? res.id : 0;
    await caller.coordinator.removeScheduled({ id });
    expect(state.scheduled.length).toBe(0);
    expect(state.airtableWriteCalls.length).toBe(0);
  });
});

describe("Equipment scheduling (local, no Airtable write)", () => {
  it("seeds and returns the equipment catalog", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const rows = await caller.coordinator.equipmentCatalog();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r: any) => r.name)).toContain("No Parking Signs");
    expect(state.airtableWriteCalls.length).toBe(0);
  });

  it("places equipment on a job/day, notifies the installer, and lists it for the week", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const res = await caller.coordinator.setEquipment({
      jobId: "recJOB1",
      equipmentName: "No Parking Signs",
      scheduledDate: "2026-06-14",
      technicianName: "Hector",
      quantity: 6,
      notes: "North curb",
    });
    expect(res.ok).toBe(true);
    expect(state.equipment.length).toBe(1);
    // Installer was notified.
    expect(state.notifications.some((n) => n.technicianName === "Hector")).toBe(true);
    // Change history recorded.
    expect(state.changeHistory.some((h) => h.action === "schedule_equipment")).toBe(true);
    expect(state.airtableWriteCalls.length).toBe(0);

    const week = await caller.coordinator.equipmentAssignments({
      startDate: "2026-06-08",
      endDate: "2026-06-14",
    });
    expect(week.length).toBe(1);
    expect(week[0].equipmentName).toBe("No Parking Signs");
    expect(week[0].quantity).toBe(6);
    expect(week[0].jobId).toBe("recJOB1");
  });

  it("removes an equipment placement by id", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const res = await caller.coordinator.setEquipment({
      jobId: "recJOB1",
      equipmentName: "Barricades",
      scheduledDate: "2026-06-15",
    });
    const id = res.id;
    await caller.coordinator.removeEquipment({ id });
    expect(state.equipment.length).toBe(0);
    expect(state.airtableWriteCalls.length).toBe(0);
  });
});

describe("Truck scheduling (local, no Airtable write)", () => {
  it("seeds and returns the truck catalog", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const rows = await caller.coordinator.truckCatalog();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r: any) => r.name === "F 14")).toBe(true);
    expect(rows.some((r: any) => r.code === "FTS-01-0004")).toBe(true);
    expect(state.airtableWriteCalls.length).toBe(0);
  });

  it("assigns a truck on a job/day, notifies the driver, logs history, and lists it for the week", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const res = await caller.coordinator.setTruck({
      jobId: "recJOB1",
      truckName: "F 14",
      scheduledDate: "2026-06-12",
      driverName: "Hector",
      notes: "Bring trailer",
    });
    expect(res.ok).toBe(true);
    expect(state.trucks.length).toBe(1);
    expect(state.trucks[0].driverName).toBe("Hector");
    expect(state.notifications.some((n) => n.technicianName === "Hector")).toBe(true);
    expect(state.changeHistory.some((h) => h.action === "schedule_truck")).toBe(true);
    expect(state.airtableWriteCalls.length).toBe(0);

    const week = await caller.coordinator.truckAssignments({
      startDate: "2026-06-08",
      endDate: "2026-06-14",
    });
    expect(week.length).toBe(1);
    expect(week[0].truckName).toBe("F 14");
    expect(week[0].driverName).toBe("Hector");
  });

  it("assigns a truck without a driver and sends no notification", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const before = state.notifications.length;
    await caller.coordinator.setTruck({
      jobId: "recJOB1",
      truckName: "FC",
      scheduledDate: "2026-06-13",
    });
    expect(state.trucks.length).toBe(1);
    expect(state.notifications.length).toBe(before);
    expect(state.airtableWriteCalls.length).toBe(0);
  });

  it("removes a truck assignment by id", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const res = await caller.coordinator.setTruck({
      jobId: "recJOB1",
      truckName: "F 14",
      scheduledDate: "2026-06-12",
    });
    const id = (res as any).id as number;
    await caller.coordinator.removeTruck({ id });
    expect(state.trucks.length).toBe(0);
    expect(state.airtableWriteCalls.length).toBe(0);
  });
});

describe("Change history is append-only and comprehensive", () => {
  it("records an entry for every assignment and never rewrites prior entries", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await caller.coordinator.assignTechnicians({
      jobId: "recJOB1",
      phase: "Setup",
      technicians: ["Hector"],
    });
    const afterFirst = [...state.changeHistory];
    expect(afterFirst.length).toBe(1);

    await caller.coordinator.modifyJob({
      jobId: "recJOB1",
      endDate: "2026-06-20",
      reason: "Client extended",
    });
    expect(state.changeHistory.length).toBe(2);
    expect(state.changeHistory[0]).toEqual(afterFirst[0]);
    expect(state.changeHistory[1].action).toBe("extend_end_date");
    expect(state.changeHistory[1].oldValue).toBe("2026-06-15");
    expect(state.changeHistory[1].newValue).toBe("2026-06-20");
  });

  it("records a coordinator internal note distinct from technician field notes", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await caller.coordinator.addInternalNote({
      jobId: "recJOB1",
      note: "Call client before pickup",
    });
    expect(state.changeHistory.length).toBe(1);
    expect(state.changeHistory[0].action).toBe("internal_note");
  });

  it("sets a technician's experience level locally without touching Airtable", async () => {
    const caller = appRouter.createCaller(adminCtx());
    expect(state.technicians[0].experienceLevel).toBe("junior");

    await caller.coordinator.setTechnicianLevel({
      airtableName: "Hector",
      level: "senior",
    });
    expect(state.technicians[0].experienceLevel).toBe("senior");

    await caller.coordinator.setTechnicianLevel({
      airtableName: "Hector",
      level: "junior",
    });
    expect(state.technicians[0].experienceLevel).toBe("junior");

    const list = await caller.coordinator.technicians();
    expect(list[0].experienceLevel).toBe("junior");
    expect(state.airtableWriteCalls.length).toBe(0);
  });
});

describe("Billing notes (Novedades) with structured invoicing fields", () => {
  it("stores the note plus structured fields locally and lists them (no Airtable write)", async () => {
    const caller = appRouter.createCaller(adminCtx());
    const res = await caller.coordinator.addBillingNote({
      jobId: "recJOB1",
      note: "Added 6 extra signs on day 2; plan stamped; Sunday work.",
      extraSignage: "6 No-Parking signs",
      weekendSurcharge: true,
      holidaySurcharge: false,
      planStamped: "yes",
      chargeAmountCents: 12500,
      chargeCategory: "Extra signage",
    });
    expect(res.ok).toBe(true);
    expect(state.billingNotes.length).toBe(1);
    expect(state.airtableWriteCalls.length).toBe(0);

    const saved = state.billingNotes[0];
    expect(saved.extraSignage).toBe("6 No-Parking signs");
    expect(saved.weekendSurcharge).toBe(true);
    expect(saved.holidaySurcharge).toBe(false);
    expect(saved.planStamped).toBe("yes");
    expect(saved.chargeAmountCents).toBe(12500);
    expect(saved.chargeCategory).toBe("Extra signage");
    expect(saved.authorName).toBe("Coordinator");

    const list = await caller.coordinator.listBillingNotes({ jobId: "recJOB1" });
    expect(list.length).toBe(1);
    expect(list[0].note).toMatch(/extra signs/);

    // A change-history entry is recorded for the billing note.
    expect(state.changeHistory.some((h) => h.action === "billing_note")).toBe(true);
  });

  it("defaults structured fields when only a free note is provided", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await caller.coordinator.addBillingNote({
      jobId: "recJOB1",
      note: "Just a quick note.",
    });
    const saved = state.billingNotes[0];
    expect(saved.weekendSurcharge).toBe(false);
    expect(saved.holidaySurcharge).toBe(false);
    expect(saved.planStamped).toBe("unknown");
    expect(saved.extraSignage).toBeNull();
    expect(saved.chargeAmountCents).toBeNull();
    expect(saved.chargeCategory).toBeNull();
  });

  it("counts notes per job and deletes a note by id", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await caller.coordinator.addBillingNote({ jobId: "recJOB1", note: "One" });
    const second = await caller.coordinator.addBillingNote({
      jobId: "recJOB1",
      note: "Two",
    });

    const counts = await caller.coordinator.billingNoteCounts({
      jobIds: ["recJOB1"],
    });
    expect(counts["recJOB1"]).toBe(2);

    await caller.coordinator.deleteBillingNote({ id: second.id! });
    const after = await caller.coordinator.billingNoteCounts({
      jobIds: ["recJOB1"],
    });
    expect(after["recJOB1"]).toBe(1);
    expect(state.airtableWriteCalls.length).toBe(0);
  });
});
