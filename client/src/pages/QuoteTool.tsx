import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildQuote,
  submissionTypeLabel,
  submissionTypeBillingNote,
  type SubmissionType,
  type EquipmentTally,
} from "@shared/pricingRules";
import { Calculator, Printer, FileText, Loader2 } from "lucide-react";

const money = (c: number) =>
  (c / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });

const SUBMISSIONS: SubmissionType[] = [
  "full_pack",
  "plan_only",
  "plan_and_setup",
  "setup_only",
  "no_parking_setup",
  "plan_and_sign_rental",
];

const EQUIPMENT_FIELDS: { key: keyof EquipmentTally; label: string }[] = [
  { key: "wmSigns", label: "Windmaster signs" },
  { key: "looseSigns", label: "Loose signs" },
  { key: "noParking", label: "No Parking signs" },
  { key: "barricades", label: "Barricades" },
  { key: "cones", label: "Cones" },
  { key: "pedestrianDetour", label: "Pedestrian detour" },
  { key: "sidewalkClosed", label: "Sidewalk closed" },
  { key: "flashers", label: "Flashers" },
  { key: "aFrames", label: "A-Frames" },
  { key: "barrels", label: "Barrels" },
  { key: "arrowBoards", label: "Arrow boards" },
  { key: "messageBoards", label: "Message boards" },
  { key: "customSigns", label: "Custom signs (one-time)" },
];

type FlaggerRow = { flaggers: string; hours: string; rate: string };

/**
 * Quotes tool — price a prospective job with the SAME rules engine the
 * invoices use (shared/pricingRules.ts), before it even exists in Airtable.
 */
export default function QuoteTool() {
  // ---- form state ----
  const [client, setClient] = useState("");
  const [address, setAddress] = useState("");
  const [submission, setSubmission] = useState<SubmissionType>("full_pack");
  const [impact, setImpact] = useState<"" | "low" | "medium" | "high">("");
  const [days, setDays] = useState("1");
  const [night, setNight] = useState(false);
  const [weekend, setWeekend] = useState(false);
  const [dailySeveral, setDailySeveral] = useState(false);
  const [plan, setPlan] = useState<"none" | "tmp" | "stamp">("none");
  const [stampCodes, setStampCodes] = useState("");
  const [permitCost, setPermitCost] = useState("");
  const [parkingBan, setParkingBan] = useState(false);
  const [stockpile, setStockpile] = useState(false);
  const [eq, setEq] = useState<Record<string, string>>({});
  const [flaggerRows, setFlaggerRows] = useState<FlaggerRow[]>([]);
  const [gst, setGst] = useState("5");

  const num = (v: string | undefined) => {
    const n = Number(v ?? "");
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  // ---- live quote from the shared rules engine ----
  const quote = useMemo(() => {
    const tally: EquipmentTally = {
      wmSigns: num(eq.wmSigns),
      looseSigns: num(eq.looseSigns),
      noParking: num(eq.noParking),
      barricades: num(eq.barricades),
      cones: num(eq.cones),
      flashers: num(eq.flashers),
      aFrames: num(eq.aFrames),
      barrels: num(eq.barrels),
      pedestrianDetour: num(eq.pedestrianDetour),
      sidewalkClosed: num(eq.sidewalkClosed),
      arrowBoards: num(eq.arrowBoards),
      messageBoards: num(eq.messageBoards),
      customSigns: num(eq.customSigns),
      totalSigns: 0,
    };
    tally.totalSigns =
      tally.wmSigns +
      tally.looseSigns +
      tally.noParking +
      tally.pedestrianDetour +
      tally.sidewalkClosed +
      tally.customSigns;
    const anyEquipment = Object.values(tally).some((v) => v > 0);
    const codes = stampCodes
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const setupDuration = [
      night ? "Night" : "",
      dailySeveral ? "Daily Setup several days" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return buildQuote({
      company: client || null,
      equipment: anyEquipment ? tally : undefined,
      signs: tally.totalSigns,
      panelSigns: tally.wmSigns + tally.looseSigns,
      days: Math.max(1, num(days)),
      setupDuration: setupDuration || null,
      impact: impact || null,
      submissionType: submission,
      planOnly: submission === "plan_only",
      weekendStart: weekend,
      hasStamp: plan === "stamp",
      hasPlan: plan !== "none",
      stampedPlans: plan === "stamp" && codes.length > 0 ? codes : undefined,
      parkingBan,
      stockpile,
      arrowBoards: tally.arrowBoards,
      messageBoards: tally.messageBoards,
      permitCostCents:
        num(permitCost) > 0 ? Math.round(num(permitCost) * 100) : null,
    });
  }, [
    client, submission, impact, days, night, weekend, dailySeveral,
    plan, stampCodes, permitCost, parkingBan, stockpile, eq,
  ]);

  const flaggerLines = useMemo(
    () =>
      flaggerRows
        .filter((r) => num(r.flaggers) > 0 && num(r.hours) > 0)
        .map((r) => {
          const rate = num(r.rate) || 40;
          return {
            description: `Flaggers × ${num(r.flaggers)} — $${rate.toFixed(2)}/h${rate >= 60 ? " (overtime)" : ""}`,
            quantity: num(r.hours),
            unitCents: Math.round(num(r.flaggers) * rate * 100),
            section: "service" as const,
          };
        }),
    [flaggerRows],
  );

  const allLines = useMemo(
    () => [...quote.lines, ...flaggerLines],
    [quote.lines, flaggerLines],
  );
  const subtotal = allLines.reduce(
    (n, l) => n + l.quantity * l.unitCents,
    0,
  );
  const rentalSubtotal = allLines
    .filter((l: any) => l.section === "rental")
    .reduce((n, l) => n + l.quantity * l.unitCents, 0);
  const gstCents = Math.round((subtotal * (Number(gst) || 0)) / 100);
  const total = subtotal + gstCents;

  // ---- save as draft invoice (shows up in the Invoices tab) ----
  const utils = trpc.useUtils();
  const createInvoice = trpc.accounting.createInvoice.useMutation({
    onSuccess: () => {
      utils.accounting.listInvoices.invalidate();
      toast.success("Draft invoice created — see the Invoices tab");
    },
    onError: (e) => toast.error(e.message || "Could not save"),
  });
  const saveAsInvoice = () => {
    if (!client.trim()) {
      toast.error("Client name is required");
      return;
    }
    createInvoice.mutate({
      airtableJobId: null,
      clientName: client.trim(),
      jobAddress: address.trim() || null,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: null,
      gstRate: Number(gst) || 5,
      notes: "QUOTE — created from the Quotes tool",
      items: allLines.map((l: any) => ({
        description: l.description,
        quantity: l.quantity,
        unitCents: l.unitCents,
      })),
      suggested: allLines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitCents: l.unitCents,
      })),
    } as any);
  };

  // ---- printable quote ----
  const printQuote = () => {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    const rows = allLines
      .map(
        (l: any) =>
          `<tr><td>${l.description}</td><td class="r">${l.quantity}</td><td class="r">${money(l.unitCents)}</td><td class="r">${money(l.quantity * l.unitCents)}</td></tr>`,
      )
      .join("");
    w.document.write(`<!doctype html><html><head><title>Quote — ${client || "Fast Traffic"}</title>
      <style>
        body{font-family:Arial,sans-serif;margin:40px;color:#111}
        h1{font-size:20px;margin:0}
        .sub{color:#555;font-size:12px;margin-bottom:24px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th{background:#1e2b58;color:#fff;text-align:left;padding:6px 8px}
        td{border-bottom:1px solid #ddd;padding:6px 8px}
        .r{text-align:right;white-space:nowrap}
        .tot{font-weight:bold}
        .note{margin-top:24px;font-size:11px;color:#777}
      </style></head><body>
      <h1>FAST TRAFFIC SOLUTIONS — QUOTE</h1>
      <div class="sub">
        ${client ? `Client: <b>${client}</b><br/>` : ""}
        ${address ? `Location: ${address}<br/>` : ""}
        Type: ${submissionTypeLabel(submission)} · ${new Date().toLocaleDateString("en-CA")}
      </div>
      <table>
        <tr><th>Description</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Total</th></tr>
        ${rows}
        <tr><td colspan="3" class="r">Subtotal</td><td class="r">${money(subtotal)}</td></tr>
        <tr><td colspan="3" class="r">GST ${gst}%</td><td class="r">${money(gstCents)}</td></tr>
        <tr class="tot"><td colspan="3" class="r">TOTAL</td><td class="r">${money(total)}</td></tr>
      </table>
      <div class="note">Estimate only — final invoice may vary with actual days, equipment and permit costs.</div>
      <script>window.print()</script></body></html>`);
    w.document.close();
  };

  const numInput = (
    value: string | undefined,
    onChange: (v: string) => void,
    w = "w-16",
  ) => (
    <Input
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={`h-8 ${w} text-right bg-background`}
      placeholder="0"
    />
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[5fr_6fr] gap-4">
      {/* ============ form ============ */}
      <div className="space-y-3">
        <div className="rounded-xl border bg-card p-3.5 space-y-2.5">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Job
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Client</label>
              <Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client name" className="h-9" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Address (optional)</label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Job location" className="h-9" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Type of Submission</label>
              <select
                value={submission}
                onChange={(e) => setSubmission(e.target.value as SubmissionType)}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                {SUBMISSIONS.map((s) => (
                  <option key={s} value={s}>{submissionTypeLabel(s)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Impact</label>
              <select
                value={impact}
                onChange={(e) => setImpact(e.target.value as any)}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">Unknown</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High (multiple lane closures)</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Days</label>
              <Input value={days} onChange={(e) => setDays(e.target.value)} className="h-9 w-24 text-right" />
            </div>
            <div className="flex items-end gap-3 pb-1 text-sm flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={night} onChange={(e) => setNight(e.target.checked)} /> Night
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={weekend} onChange={(e) => setWeekend(e.target.checked)} /> Weekend
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer" title="Daily setup, several days — setup fee bills each day">
                <input type="checkbox" checked={dailySeveral} onChange={(e) => setDailySeveral(e.target.checked)} /> Daily × days
              </label>
            </div>
          </div>
          {submissionTypeBillingNote(submission) && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-800">
              {submissionTypeBillingNote(submission)}
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-card p-3.5 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Equipment (units on site)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5">
            {EQUIPMENT_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-1.5 text-[12px]">
                <span className="truncate">{f.label}</span>
                {numInput(eq[f.key], (v) => setEq({ ...eq, [f.key]: v }), "w-14")}
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-3.5 space-y-2.5">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Plan · Permits · Extras
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Plan</label>
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value as any)}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="none">No plan / by client</option>
                <option value="tmp">TMP — $400</option>
                <option value="stamp">Engineering stamp — $550 each</option>
              </select>
            </div>
            {plan === "stamp" && (
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">
                  Stamp codes (comma separated — one $550 each)
                </label>
                <Input value={stampCodes} onChange={(e) => setStampCodes(e.target.value)} placeholder="FTS-26-0001, FTS-26-0002" className="h-9" />
              </div>
            )}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">
                City permit cost $ (pass-through)
              </label>
              <Input value={permitCost} onChange={(e) => setPermitCost(e.target.value)} placeholder="0.00" className="h-9 w-28 text-right" />
            </div>
            <div className="flex items-end gap-4 pb-1 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={parkingBan} onChange={(e) => setParkingBan(e.target.checked)} /> Parking ban ($350)
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={stockpile} onChange={(e) => setStockpile(e.target.checked)} /> Stockpile
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Flaggers
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-orange-700"
              onClick={() =>
                setFlaggerRows([...flaggerRows, { flaggers: "1", hours: "8", rate: "40" }])
              }
            >
              + Add
            </Button>
          </div>
          {flaggerRows.length === 0 && (
            <div className="text-[11px] text-muted-foreground">
              No flaggers — $40/h regular, 1.5× past 8h/day.
            </div>
          )}
          {flaggerRows.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              <span># Flaggers</span>
              {numInput(r.flaggers, (v) => {
                const rows = [...flaggerRows]; rows[i] = { ...r, flaggers: v }; setFlaggerRows(rows);
              }, "w-14")}
              <span>Hours</span>
              {numInput(r.hours, (v) => {
                const rows = [...flaggerRows]; rows[i] = { ...r, hours: v }; setFlaggerRows(rows);
              }, "w-14")}
              <span>$/h</span>
              {numInput(r.rate, (v) => {
                const rows = [...flaggerRows]; rows[i] = { ...r, rate: v }; setFlaggerRows(rows);
              }, "w-16")}
              <button
                className="text-muted-foreground hover:text-red-600 ml-auto"
                onClick={() => setFlaggerRows(flaggerRows.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ============ result ============ */}
      <div className="space-y-3">
        <div className="rounded-xl border-2 border-primary/30 bg-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-bold flex items-center gap-2">
              <Calculator className="size-4 text-primary" /> Quote
              {client && <span className="text-muted-foreground font-normal">— {client}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={printQuote} disabled={allLines.length === 0}>
                <Printer className="size-4 mr-1" /> Print / PDF
              </Button>
              <Button size="sm" onClick={saveAsInvoice} disabled={allLines.length === 0 || createInvoice.isPending}>
                {createInvoice.isPending ? (
                  <Loader2 className="size-4 mr-1 animate-spin" />
                ) : (
                  <FileText className="size-4 mr-1" />
                )}
                Save as draft invoice
              </Button>
            </div>
          </div>
          {allLines.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              Fill the form — the quote builds itself with the FTS billing rules.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                  <th className="text-left py-1">Description</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Unit</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {allLines.map((l: any, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1.5 pr-2">
                      {l.section === "rental" && (
                        <span className="inline-block size-2 rounded-full bg-blue-400 mr-1.5" title="Rental" />
                      )}
                      {l.description}
                    </td>
                    <td className="text-right tabular-nums">{l.quantity}</td>
                    <td className="text-right tabular-nums">{money(l.unitCents)}</td>
                    <td className="text-right tabular-nums font-medium">
                      {money(l.quantity * l.unitCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="tabular-nums">
                {rentalSubtotal > 0 && (
                  <tr className="text-[12px] text-blue-800">
                    <td colSpan={3} className="text-right pt-1.5">Rental subtotal</td>
                    <td className="text-right pt-1.5">{money(rentalSubtotal)}</td>
                  </tr>
                )}
                <tr>
                  <td colSpan={3} className="text-right pt-1">Subtotal</td>
                  <td className="text-right pt-1">{money(subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="text-right">
                    GST{" "}
                    <input
                      value={gst}
                      onChange={(e) => setGst(e.target.value)}
                      className="w-10 h-6 text-right border border-border rounded px-1 text-[12px] bg-background"
                    />
                    %
                  </td>
                  <td className="text-right">{money(gstCents)}</td>
                </tr>
                <tr className="font-bold text-base">
                  <td colSpan={3} className="text-right pt-1">TOTAL</td>
                  <td className="text-right pt-1">{money(total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {quote.reasons.length > 0 && (
          <div className="rounded-xl border bg-muted/30 p-3.5">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
              How this quote was built
            </div>
            <ul className="text-[12px] text-muted-foreground space-y-1 list-disc pl-4">
              {quote.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
