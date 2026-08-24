import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ShieldCheck,
  Loader2,
  AlertTriangle,
  Truck,
  FileCheck2,
  Search,
} from "lucide-react";

function fmtT(ts: string | number | Date | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Edmonton",
  });
}

const SEV_CLS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  major: "bg-orange-100 text-orange-800 border-orange-300",
  minor: "bg-amber-50 text-amber-800 border-amber-200",
};

/**
 * Safety reports (coordinator console): daily compliance by technician,
 * project safety packages, and the defect / corrective-action register.
 */
export default function SafetyReports() {
  const todayKey = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Edmonton",
  });
  const [tab, setTab] = useState<"day" | "project" | "defects">("day");
  const [date, setDate] = useState(todayKey);
  const utils = trpc.useUtils();

  const dayQ = trpc.safety.dayReport.useQuery({ date }, { enabled: tab === "day" });
  const defectsQ = trpc.safety.defects.useQuery(undefined, {
    enabled: tab === "defects",
  });
  const jobsQ = trpc.coordinator.mapJobs.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const jobById = useMemo(
    () => new Map(((jobsQ.data ?? []) as any[]).map((j) => [j.id, j])),
    [jobsQ.data],
  );

  // Project package
  const [projSearch, setProjSearch] = useState("");
  const [projId, setProjId] = useState<string>("");
  const projHits = useMemo(() => {
    const q = projSearch.trim().toLowerCase();
    if (!q) return [];
    return ((jobsQ.data ?? []) as any[])
      .filter(
        (j) =>
          (j.company ?? "").toLowerCase().includes(q) ||
          (j.jobAddress ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [jobsQ.data, projSearch]);
  const pkgQ = trpc.safety.jobPackage.useQuery(
    { jobId: projId },
    { enabled: tab === "project" && !!projId },
  );

  const release = trpc.safety.releaseDefect.useMutation({
    onSuccess: () => {
      utils.safety.defects.invalidate();
      toast.success("Defect released");
    },
    onError: (e) => toast.error(e.message),
  });

  const jobLabel = (id: string) => {
    const j = jobById.get(id);
    return j ? `${j.company ?? "Job"} — ${j.jobAddress ?? ""}` : id;
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" /> Safety
          </h1>
          <p className="text-sm text-muted-foreground">
            Every record is immutable and stamped with its controlled form
            number and version — audit evidence for ACSA COR.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {(
            [
              ["day", "Daily report"],
              ["project", "By project"],
              ["defects", "Defects"],
            ] as const
          ).map(([k, label]) => (
            <Button
              key={k}
              size="sm"
              variant={tab === k ? "default" : "outline"}
              onClick={() => setTab(k)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* ================= Daily compliance ================= */}
      {tab === "day" && (
        <div className="space-y-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          />
          {dayQ.isLoading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (dayQ.data?.rows.length ?? 0) === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No technician started a day on {date}.
            </div>
          ) : (
            <div className="space-y-2">
              {dayQ.data!.rows.map((r) => (
                <div
                  key={r.technicianName}
                  className={cn(
                    "rounded-xl border bg-card p-3.5",
                    r.exceptions.length > 0 && "border-amber-300 bg-amber-50/40",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.technicianName}</span>
                    {r.truck && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Truck className="size-3.5" /> {r.truck}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground ml-auto">
                      In {fmtT(r.checkInAt)} · Out {fmtT(r.checkOutAt)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <span className={cn("rounded-full border px-2 py-0.5 font-semibold", r.startOfDay ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-rose-50 border-rose-300 text-rose-800")}>
                      Start-of-day {r.startOfDay ? `✓ ${fmtT(r.startOfDay.at)}` : "✗"}
                    </span>
                    <span className={cn("rounded-full border px-2 py-0.5 font-semibold", r.vehicleInspection ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-rose-50 border-rose-300 text-rose-800")}>
                      Vehicle {r.vehicleInspection ? `✓ ${fmtT(r.vehicleInspection.at)}` : "✗"}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5">
                      Depart {fmtT(r.departWarehouseAt)} · Site {fmtT(r.arriveSiteAt)} · Return {fmtT(r.returnWarehouseAt)}
                    </span>
                  </div>
                  {r.startWorkJobs.length > 0 && (
                    <div className="mt-1.5 text-[12px]">
                      <span className="font-semibold text-emerald-700">
                        ✓ Safe to proceed:
                      </span>{" "}
                      {r.startWorkJobs
                        .map((a) => `${jobLabel(a.jobId)} (${fmtT(a.at)})`)
                        .join(" · ")}
                    </div>
                  )}
                  {r.defects.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {r.defects.map((d) => (
                        <span
                          key={d.id}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                            SEV_CLS[d.severity] ?? "border-border",
                          )}
                          title={d.description}
                        >
                          {d.refNumber} · {d.severity} · {d.unitName} · {d.status}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.exceptions.length > 0 && (
                    <div className="mt-1.5 text-[12px] font-semibold text-amber-800 flex items-center gap-1">
                      <AlertTriangle className="size-3.5" />
                      {r.exceptions.join(" · ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= Project package ================= */}
      {tab === "project" && (
        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={projSearch}
              onChange={(e) => {
                setProjSearch(e.target.value);
                setProjId("");
              }}
              placeholder="Search client or address…"
              className="pl-8 h-9"
            />
            {!projId && projHits.length > 0 && (
              <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-64 overflow-y-auto">
                {projHits.map((j: any) => (
                  <button
                    key={j.id}
                    className="block w-full text-left px-2.5 py-2 text-sm hover:bg-accent truncate"
                    onClick={() => {
                      setProjId(j.id);
                      setProjSearch(`${j.company ?? "Job"} — ${j.jobAddress ?? ""}`);
                    }}
                  >
                    {j.company} — {j.jobAddress}
                  </button>
                ))}
              </div>
            )}
          </div>
          {projId && pkgQ.data && (
            <div className="rounded-xl border bg-card p-3.5 space-y-2">
              <div className="font-semibold flex items-center gap-2">
                <FileCheck2 className="size-4 text-primary" /> Safety package
              </div>
              {pkgQ.data.submissions.length === 0 &&
              pkgQ.data.startWork.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No safety records for this project yet.
                </p>
              ) : (
                <>
                  {pkgQ.data.startWork.length > 0 && (
                    <div className="text-[12px]">
                      <span className="font-semibold text-emerald-700">
                        Start-work authorizations:
                      </span>{" "}
                      {pkgQ.data.startWork
                        .map((a) => `${a.technicianName} · ${a.date}`)
                        .join(" — ")}
                    </div>
                  )}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                        <th className="text-left py-1">Form</th>
                        <th className="text-left">Technician</th>
                        <th className="text-left">Date</th>
                        <th className="text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pkgQ.data.submissions.map((s) => (
                        <tr key={s.id} className="border-b border-border/50">
                          <td className="py-1.5 font-medium">
                            {s.formNumber} {s.formVersion}
                            {s.revisionOf ? (
                              <span className="ml-1 text-[10px] text-amber-700 font-bold">
                                REV of #{s.revisionOf}
                              </span>
                            ) : null}
                          </td>
                          <td>{s.technicianName}</td>
                          <td>{s.shiftDate}</td>
                          <td>{s.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================= Defect register ================= */}
      {tab === "defects" && (
        <div className="space-y-2">
          {(defectsQ.data ?? []).length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No defects reported.
            </div>
          ) : (
            (defectsQ.data ?? []).map((d: any) => (
              <div
                key={d.id}
                className={cn(
                  "rounded-xl border bg-card p-3.5",
                  d.severity === "critical" && d.status === "open" &&
                    "border-red-400 bg-red-50/50",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold tabular-nums">{d.refNumber}</span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase",
                      SEV_CLS[d.severity],
                    )}
                  >
                    {d.severity}
                  </span>
                  <span className="text-sm">{d.unitName}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {d.category} · {d.date} · {d.technicianName}
                  </span>
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold",
                      d.status === "open"
                        ? "bg-rose-100 text-rose-800"
                        : "bg-emerald-100 text-emerald-800",
                    )}
                  >
                    {d.status}
                  </span>
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap">{d.description}</p>
                {d.severity === "critical" && d.status === "open" && (
                  <div className="mt-1 text-[12px] font-bold text-red-700">
                    🚫 DO NOT OPERATE — {d.unitName}
                  </div>
                )}
                {d.status === "open" && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={release.isPending}
                      onClick={() => {
                        const action = window.prompt(
                          `Release ${d.refNumber} — what was done to fix it? (required)`,
                        );
                        if (action?.trim())
                          release.mutate({ id: d.id, actionTaken: action.trim() });
                      }}
                    >
                      Release (authorized)
                    </Button>
                  </div>
                )}
                {d.status !== "open" && d.actionTaken && (
                  <div className="mt-1 text-[12px] text-muted-foreground">
                    Fixed: {d.actionTaken} — released by {d.releasedBy}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
