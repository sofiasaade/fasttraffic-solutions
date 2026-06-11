// Pure status-classification helpers shared by the Scheduler and Permit Map.
// Kept free of React so it can be unit-tested directly.

export interface StatusLike {
  status: string | null;
  subStatus: string | null;
}

/**
 * A job counts as cancelled when its sub-status says so (jobs often stay on a
 * status like "Field" but carry a cancelled/declined sub-status), or when the
 * top-level status itself indicates a cancellation or decline.
 */
export function isCancelledJob(j: StatusLike): boolean {
  const sub = (j.subStatus ?? "").toLowerCase();
  const st = (j.status ?? "").toLowerCase();
  return (
    st.includes("cancel") ||
    st.includes("declin") ||
    sub.includes("cancel") ||
    sub.includes("declin")
  );
}

/**
 * The coordinator's assignment state for a job, derived from how many
 * technicians are assigned and whether they are confirmed:
 *  - "pending"    -> no technician assigned at all (needs coordinator action)
 *  - "tentative"  -> at least one technician assigned, but not all confirmed
 *  - "confirmed"  -> every assigned technician is confirmed
 *
 * Cancelled jobs return "cancelled" and are excluded from pending alerts.
 */
export type AssignmentState =
  | "pending"
  | "tentative"
  | "confirmed"
  | "cancelled";

export function deriveAssignmentState(input: {
  status: string | null;
  subStatus: string | null;
  total: number;
  confirmed: number;
}): AssignmentState {
  if (isCancelledJob(input)) return "cancelled";
  if (input.total === 0) return "pending";
  if (input.confirmed >= input.total) return "confirmed";
  return "tentative";
}
