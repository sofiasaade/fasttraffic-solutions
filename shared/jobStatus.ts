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
