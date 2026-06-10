import { describe, expect, it } from "vitest";
import { pingAirtable, fetchDispatchJobs } from "./airtable";
import { ENV } from "./_core/env";

// This test validates the provided Airtable credentials against the live API.
describe("airtable connection", () => {
  it("has credentials configured", () => {
    expect(ENV.airtableApiKey).toBeTruthy();
    expect(ENV.airtableBaseId).toBeTruthy();
    expect(ENV.airtableJobsTableId).toBeTruthy();
  });

  it("can reach the Approved Jobs table", async () => {
    const result = await pingAirtable();
    expect(result.ok).toBe(true);
  }, 30000);

  it("can fetch dispatch jobs (Field / Permit Approved)", async () => {
    const jobs = await fetchDispatchJobs();
    expect(Array.isArray(jobs)).toBe(true);
    // Each job should have an id and a status within the dispatch set
    for (const j of jobs.slice(0, 5)) {
      expect(j.id).toBeTruthy();
      expect(["Field", "Permit Approved"]).toContain(j.status);
    }
  }, 30000);
});
