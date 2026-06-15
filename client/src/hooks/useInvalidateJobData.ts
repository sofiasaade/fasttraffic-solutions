import { useCallback } from "react";
import { trpc } from "@/lib/trpc";

/**
 * useInvalidateJobData
 *
 * Central place to refresh every coordinator query that depends on job data.
 * The app shows the same jobs across many windows (Dashboard, Scheduler,
 * Dispatch, Day Timeline, Pending, Map, Alerts…), each backed by its own tRPC
 * query. Historically each mutation invalidated only a subset, so a change in
 * one window was not reflected in the others until a manual refresh.
 *
 * Calling the returned function after ANY job-affecting mutation invalidates
 * all of them, so every window reloads from the single shared source and stays
 * consistent. tRPC only refetches queries that are currently mounted, so this
 * is cheap: invalidating a query no window is showing is a no-op.
 */
export function useInvalidateJobData() {
  const utils = trpc.useUtils();

  return useCallback(() => {
    const c = utils.coordinator;
    // Job lists / boards
    c.mapJobs.invalidate();
    c.boardJobs.invalidate();
    c.dispatchJobs.invalidate();
    c.pendingJobs.invalidate();
    c.jobDetail.invalidate();
    // Scheduling (technicians / equipment / trucks pinned to days)
    c.scheduledAssignments.invalidate();
    c.equipmentAssignments.invalidate();
    c.truckAssignments.invalidate();
    // Day-oriented views
    c.dashboardDay.invalidate();
    c.dayTimeline.invalidate();
    // Change tracking badges / alerts
    c.changeBadges.invalidate();
    c.recentChanges.invalidate();
    c.changeHistory.invalidate();
  }, [utils]);
}
