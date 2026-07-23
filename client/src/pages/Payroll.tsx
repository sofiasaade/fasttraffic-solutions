import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function fmtDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
  });
}

const h = (n: number) => (n > 0 ? n.toFixed(1) : "—");

export default function Payroll() {
  const [weekStart, setWeekStart] = useState<string | undefined>(undefined);
  const q = trpc.coordinator.payroll.useQuery({ weekStart });

  const d = q.data;
  const activeWithHours = d ? d.rows.filter((r) => r.total > 0).length : 0;
  const grand = d
    ? d.rows.reduce(
        (acc, r) => ({
          total: acc.total + r.total,
          regular: acc.regular + r.regular,
          overtime: acc.overtime + r.overtime,
        }),
        { total: 0, regular: 0, overtime: 0 },
      )
    : null;

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
            <Wallet className="size-6 text-primary" /> Payroll
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Hours per active employee — daily detail, weekly regular vs
            overtime (OT after {d?.threshold ?? 44}h/week).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={() => d && setWeekStart(addDays(d.weekStart, -7))}
            aria-label="Previous week"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="text-sm font-semibold tabular-nums min-w-40 text-center">
            {d ? `${fmtDay(d.days[0])} – ${fmtDay(d.days[6])}` : "…"}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={() => d && setWeekStart(addDays(d.weekStart, 7))}
            aria-label="Next week"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekStart(undefined)}
          >
            This week
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {grand && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          {[
            { label: "Active employees w/ hours", v: String(activeWithHours) },
            { label: "Total hours", v: grand.total.toFixed(1) + "h" },
            { label: "Regular", v: grand.regular.toFixed(1) + "h" },
            {
              label: "Overtime",
              v: grand.overtime.toFixed(1) + "h",
              danger: grand.overtime > 0,
            },
          ].map((c) => (
            <div
              key={c.label}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <div
                className={cn(
                  "text-2xl font-extrabold tabular-nums",
                  (c as any).danger && "text-red-600",
                )}
              >
                {c.v}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {c.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="mt-4 rounded-2xl border border-border bg-card overflow-x-auto">
        {q.isLoading ? (
          <div className="flex items-center gap-2 p-8 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading payroll…
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Employee</th>
                {d?.days.map((k) => (
                  <th key={k} className="px-2 py-2.5 font-semibold text-right">
                    {fmtDay(k)}
                  </th>
                ))}
                <th className="px-3 py-2.5 font-semibold text-right">Total</th>
                <th className="px-3 py-2.5 font-semibold text-right">Regular</th>
                <th className="px-4 py-2.5 font-semibold text-right">OT</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {d?.rows.map((r) => (
                <tr
                  key={r.technicianName}
                  className="border-b border-border/60 last:border-0 hover:bg-accent/40"
                >
                  <td className="px-4 py-2 font-medium whitespace-nowrap">
                    {r.technicianName}
                  </td>
                  {r.perDay.map((v, i) => (
                    <td
                      key={i}
                      className={cn(
                        "px-2 py-2 text-right",
                        v > 8 && "text-amber-600 font-semibold",
                        v === 0 && "text-muted-foreground/40",
                      )}
                    >
                      {h(v)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-bold">
                    {h(r.total)}
                  </td>
                  <td className="px-3 py-2 text-right">{h(r.regular)}</td>
                  <td
                    className={cn(
                      "px-4 py-2 text-right font-bold",
                      r.overtime > 0 ? "text-red-600" : "text-muted-foreground/40",
                    )}
                  >
                    {h(r.overtime)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        Hours come from technician check-ins/check-outs. Days over 8h are
        highlighted amber; weekly overtime in red.
      </p>
    </div>
  );
}
