export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Date-only strings must parse as LOCAL midnight — new Date("2026-08-24")
  // is midnight UTC, which renders as the PREVIOUS day in Calgary.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T00:00:00`)
    : new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtTimeRange(setupDuration: string | null): string {
  if (!setupDuration) return "";
  const m = setupDuration.match(/\(([^)]+)\)/);
  return m ? m[1] : setupDuration;
}

/** "19:00" -> "7:00 PM" (falls back to the input if it isn't HH:MM). */
export function fmtTime12(t: string | null | undefined): string {
  if (!t) return "";
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(t);
  let h = Number(m[1]);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}

/** "07:00","15:00" -> "7:00 AM – 3:00 PM". */
export function fmtTime12Range(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const s = fmtTime12(start);
  const e = fmtTime12(end);
  if (s && e) return `${s} – ${e}`;
  return s || e;
}

export function dayKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
