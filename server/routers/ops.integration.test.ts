import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration tests for the core safety/operations rules.
 * Airtable and the opsDb layer are mocked so these run without network/DB.
 */

// ---- Mock state ----
const state = {
  hazard: null as any,
  openTimeLog: null as any,
  changeHistory: [] as any[],
  notifications: [] as any[],
  jobs: {} as Record<string, any>,
  dispatchJobs: [] as any[],
  technicians: [] as any[],
  updateCalls: [] as { id: string; fields: Record<string, unknown> }[],
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

// ---- Mock Airtable ----
vi.mock("../airtable", () => ({
  fetchJobById: vi.fn(async (id: string) => state.jobs[id] ?? makeJob({ id })),
  fetchDispatchJobs: vi.fn(async () => state.dispatchJobs),
  updateJobFields: vi.fn(async (id: string, fields: Record<string, unknown>) => {
    state.updateCalls.push({ id, fields });
    state.jobs[id] = { ...(state.jobs[id] ?? makeJob({ id })), ...mapFields(fields) };
    return state.jobs[id];
  }),
  appendToTextField: vi.fn(async () => makeJob()),
  appendAttachments: vi.fn(async () => makeJob()),
  fetchJobsForTechnician: vi.fn(async () => state.dispatchJobs),
}));

function mapFields(fields: Record<string, unknown>) {
  const out: any = {};
  if ("Traffic Technician Setup" in fields)
    out.techSetup = fields["Traffic Technician Setup"];
  if ("End Date" in fields) out.endDate = fields["End Date"];
  return out;
}

// ---- Mock opsDb ----
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
    // append-only: never mutate or remove existing entries
    state.changeHistory.push({ id: state.changeHistory.length + 1, createdAt: new Date(), ...entry });
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
  getTechnicianByUserId: vi.fn(async () => ({
    id: 1,
    airtableName: "Hector",
    displayName: "Hector",
    userId: 7,
    phone: null,
    zones: null,
    active: true,
  })),
  getOvertimeThreshold: vi.fn(async () => 44),
  sumHoursInPeriod: vi.fn(async () => []),
  listOpenTimeLogs: vi.fn(async () => []),
  setSetting: vi.fn(async () => {}),
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
  state.technicians = [
    { id: 1, airtableName: "Hector", displayName: "Hector", userId: 7, phone: null, zones: null, active: true },
  ];
  state.updateCalls = [];
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

describe("Assignment conflict detection", () => {
  it("blocks a double-booking unless forced", async () => {
    // Another overlapping job already has Hector on Setup.
    const other = makeJob({
      id: "recJOB2",
      company: "Other",
      techSetup: ["Hector"],
      startDate: "2026-06-15",
      endDate: "2026-06-15",
    });
    state.dispatchJobs = [makeJob(), other];

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
    // No Airtable write should have happened on a blocked assignment.
    expect(state.updateCalls.length).toBe(0);
  });

  it("writes the assignment to Airtable when forced over a conflict", async () => {
    const other = makeJob({ id: "recJOB2", techSetup: ["Hector"] });
    state.dispatchJobs = [makeJob(), other];

    const caller = appRouter.createCaller(adminCtx());
    const res = await caller.coordinator.assignTechnicians({
      jobId: "recJOB1",
      phase: "Setup",
      technicians: ["Hector"],
      force: true,
    });
    expect(res.ok).toBe(true);
    expect(state.updateCalls.length).toBe(1);
    expect(state.updateCalls[0].fields["Traffic Technician Setup"]).toEqual([
      "Hector",
    ]);
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

    // A modification adds a new entry, leaving the first untouched.
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
});
