import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Search,
  Receipt,
  FileSpreadsheet,
  Plus,
  Trash2,
  Printer,
  Building2,
  X,
  Lock,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { fmtDate } from "@/lib/format";
import { pickPlans, pickPermits, pickOtherDocs } from "@shared/planDocs";

function money(cents: number) {
  return (cents / 100).toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
  });
}

/** Parse "$215.35" / "215.35" / "215" into cents (null when not a number). */
function parseMoneyToCents(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = String(v).replace(/[$,\s]/g, "");
  const n = Number(m);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  void: "bg-rose-100 text-rose-700",
};

type NewItem = { description: string; quantity: string; unit: string };

export default function Accounting() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"airtable" | "invoices">("airtable");
  const [q, setQ] = useState("");

  // Accounting has its own PIN on top of the coordinator session.
  const lockQ = trpc.accounting.lockStatus.useQuery();
  const unlocked = !!lockQ.data?.unlocked;
  const [pinInput, setPinInput] = useState("");
  const unlock = trpc.accounting.unlock.useMutation({
    onSuccess: () => {
      setPinInput("");
      lockQ.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const lock = trpc.accounting.lock.useMutation({
    onSuccess: () => lockQ.refetch(),
  });

  const airtableQ = trpc.accounting.airtableAccounting.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    enabled: unlocked,
  });
  const invoicesQ = trpc.accounting.listInvoices.useQuery(undefined, {
    enabled: unlocked,
  });
  const utils = trpc.useUtils();

  const createInvoice = trpc.accounting.createInvoice.useMutation({
    onSuccess: (r) => {
      toast.success(`Invoice ${r.invoiceNumber} created`);
      setCreating(null);
      utils.accounting.listInvoices.invalidate();
      setTab("invoices");
    },
    onError: (e) => toast.error(e.message),
  });
  const setStatus = trpc.accounting.setInvoiceStatus.useMutation({
    onSuccess: () => utils.accounting.listInvoices.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const deleteInvoice = trpc.accounting.deleteInvoice.useMutation({
    onSuccess: () => {
      toast.success("Draft deleted");
      utils.accounting.listInvoices.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ---- Airtable table (read-only) ----
  const READY = "Job Completed - Ready to Bill";
  const PICKED = "Setup Finished - Picked up";
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "picked">(
    "all",
  );
  const statusCounts = useMemo(() => {
    const rows = airtableQ.data ?? [];
    return {
      ready: rows.filter((r) => r.status === READY).length,
      picked: rows.filter((r) => r.status === PICKED).length,
      all: rows.length,
    };
  }, [airtableQ.data]);
  const airtableRows = useMemo(() => {
    let rows = airtableQ.data ?? [];
    if (statusFilter === "ready") rows = rows.filter((r) => r.status === READY);
    if (statusFilter === "picked") rows = rows.filter((r) => r.status === PICKED);
    const ql = q.trim().toLowerCase();
    if (ql) {
      rows = rows.filter((r) =>
        `${r.company ?? ""} ${r.jobAddress ?? ""} ${r.estimateInvoice ?? ""} ${r.poNumber ?? ""}`
          .toLowerCase()
          .includes(ql),
      );
    }
    // Ready to Bill first, then Picked up; newest first inside each group.
    const groupOf = (s: string | null) => (s === READY ? 0 : 1);
    return [...rows].sort((a, b) => {
      const g = groupOf(a.status) - groupOf(b.status);
      if (g !== 0) return g;
      return (b.startDate ?? "").localeCompare(a.startDate ?? "");
    });
  }, [airtableQ.data, q, statusFilter]);

  // ---- New invoice dialog ----
  const [creating, setCreating] = useState<{
    jobId: string | null;
    clientName: string;
    jobAddress: string;
    issueDate: string;
    dueDate: string;
    gstRate: string;
    notes: string;
    items: NewItem[];
  } | null>(null);
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [jobPickerQ, setJobPickerQ] = useState("");

  const openNewInvoice = (job?: (typeof airtableRows)[number]) => {
    // Pre-fill line items from the Airtable charges when present.
    const items: NewItem[] = [];
    const addIf = (label: string, v: string | null) => {
      const cents = parseMoneyToCents(v);
      if (cents) {
        items.push({
          description: label,
          quantity: "1",
          unit: (cents / 100).toFixed(2),
        });
      }
    };
    if (job) {
      addIf("Traffic Management Plan", job.planCharge);
      addIf("Set-up & Pickup", job.setUpCharge);
      addIf("Equipment rental", job.rentalCharge);
      addIf("City permit cost", job.permitCost);
      addIf("Arrow boards", job.arrowBoards);
      addIf("Message boards", job.messageBoards);
      addIf("Delivery", job.deliveryCharge);
      addIf("ACQ", job.acq);
      addIf("Schedule", job.scheduleCharge);
    }
    if (items.length === 0) {
      items.push({ description: "Traffic control services", quantity: "1", unit: "" });
    }
    setQuoteReasons([]);
    setDocIdx(0);
    setQuoteReasons([]);
    setCreating({
      jobId: job?.id ?? null,
      clientName: job?.company ?? "",
      jobAddress: job?.jobAddress ?? "",
      issueDate: todayKey(),
      dueDate: "",
      gstRate: "5",
      notes: job?.poNumber ? `PO # ${job.poNumber}` : "",
      items,
    });
  };

  // ---- Auto-quote from the FTS pricing rules ----
  const [quoting, setQuoting] = useState(false);
  const [quoteReasons, setQuoteReasons] = useState<string[]>([]);
  const autoQuoteFor = async (jobId: string) => {
    setQuoting(true);
    try {
      const q = await utils.accounting.suggestQuote.fetch({ jobId });
      setCreating((prev) =>
        prev
          ? {
              ...prev,
              items: q.lines.map((l) => ({
                description: l.description,
                quantity: String(l.quantity),
                unit: (l.unitCents / 100).toFixed(2),
              })),
            }
          : prev,
      );
      setQuoteReasons(q.reasons);
      toast.success(`Auto-quote: ${q.industry} · ${q.complexity}`);
    } catch (e: any) {
      toast.error(e.message ?? "Could not auto-quote");
    } finally {
      setQuoting(false);
    }
  };
  const autoQuote = () => {
    if (creating?.jobId) void autoQuoteFor(creating.jobId);
  };

  // Plans + Airtable info for the side panel while invoicing.
  const [docIdx, setDocIdx] = useState(0);
  const workJobId = creating?.jobId ?? "";
  const jobDetailQ = trpc.coordinator.jobDetail.useQuery(
    { jobId: workJobId },
    { enabled: !!workJobId },
  );
  const allFieldsQ = trpc.coordinator.jobAllFields.useQuery(
    { jobId: workJobId },
    { enabled: !!workJobId },
  );
  const viewDocs = useMemo(() => {
    const files = ((jobDetailQ.data?.job as any)?.planFile ?? []) as {
      filename?: string | null;
      url: string;
    }[];
    return [
      ...pickPlans(files).map((f) => ({ ...f, kind: "Plan" })),
      ...pickPermits(files).map((f) => ({ ...f, kind: "Permit" })),
      ...pickOtherDocs(files).map((f) => ({ ...f, kind: "Doc" })),
    ];
  }, [jobDetailQ.data]);

  const creatingTotals = useMemo(() => {
    if (!creating) return { sub: 0, gst: 0, total: 0 };
    const sub = creating.items.reduce((n, it) => {
      const qn = Number(it.quantity) || 0;
      const un = Number(it.unit) || 0;
      return n + Math.round(qn * un * 100);
    }, 0);
    const gst = Math.round((sub * (Number(creating.gstRate) || 0)) / 100);
    return { sub, gst, total: sub + gst };
  }, [creating]);

  const submitInvoice = () => {
    if (!creating) return;
    const items = creating.items
      .filter((it) => it.description.trim() && Number(it.quantity) > 0 && Number(it.unit) > 0)
      .map((it) => ({
        description: it.description.trim(),
        quantity: Number(it.quantity),
        unitCents: Math.round(Number(it.unit) * 100),
      }));
    if (!creating.clientName.trim()) return toast.error("Client name is required");
    if (items.length === 0) return toast.error("Add at least one line with an amount");
    createInvoice.mutate({
      airtableJobId: creating.jobId,
      clientName: creating.clientName.trim(),
      jobAddress: creating.jobAddress.trim() || null,
      issueDate: creating.issueDate,
      dueDate: creating.dueDate || null,
      gstRate: Number(creating.gstRate) || 0,
      notes: creating.notes.trim() || null,
      items,
    });
  };

  // ---- Printable invoice ----
  const [printing, setPrinting] = useState<NonNullable<typeof invoicesQ.data>[number] | null>(null);
  const doPrint = () => window.print();

  // ---- Locked: ask for the accounting PIN before showing anything ----
  if (!lockQ.isLoading && !unlocked) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 space-y-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Receipt className="size-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Accounting</h1>
            <p className="text-xs text-muted-foreground">
              This section requires its own PIN, separate from the coordinator PIN.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{4,8}$/.test(pinInput)) unlock.mutate({ pin: pinInput });
              else toast.error("Enter the accounting PIN");
            }}
            className="space-y-3"
          >
            <Input
              autoFocus
              type="password"
              inputMode="numeric"
              placeholder="••••"
              className="text-center text-lg tracking-[0.5em]"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
              maxLength={8}
            />
            <Button type="submit" className="w-full" disabled={unlock.isPending}>
              {unlock.isPending && <Loader2 className="size-4 mr-1 animate-spin" />}
              Unlock accounting
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!creating && (
        <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
            <Receipt className="size-5 text-primary" /> Accounting
          </h1>
          <p className="text-xs text-muted-foreground">
            Airtable billing info (read-only) · FTS invoices
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={tab === "airtable" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("airtable")}
          >
            <FileSpreadsheet className="size-4 mr-1" /> Airtable
          </Button>
          <Button
            variant={tab === "invoices" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("invoices")}
          >
            <Receipt className="size-4 mr-1" /> Invoices
            {(invoicesQ.data?.length ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-primary-foreground/20 px-1.5 text-[10px] tabular-nums">
                {invoicesQ.data?.length}
              </span>
            )}
          </Button>
          <Button size="sm" onClick={() => openNewInvoice()}>
            <Plus className="size-4 mr-1" /> New invoice
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Lock the accounting section"
            onClick={() => lock.mutate()}
          >
            <Lock className="size-4" />
          </Button>
        </div>
      </div>

      {tab === "airtable" && (
        <div className="space-y-3 print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search client, address, invoice #, PO #…"
                className="pl-8 h-9"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors",
                  statusFilter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent",
                )}
              >
                All ({airtableQ.isLoading ? "…" : statusCounts.all})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("ready")}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors",
                  statusFilter === "ready"
                    ? "bg-purple-600 text-white"
                    : "bg-purple-100 text-purple-700 hover:bg-purple-200",
                )}
              >
                Ready to Bill ({airtableQ.isLoading ? "…" : statusCounts.ready})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("picked")}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors",
                  statusFilter === "picked"
                    ? "bg-rose-600 text-white"
                    : "bg-rose-100 text-rose-700 hover:bg-rose-200",
                )}
              >
                Picked up ({airtableQ.isLoading ? "…" : statusCounts.picked})
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            {airtableQ.isLoading ? (
              <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading Airtable accounting…
              </div>
            ) : airtableRows.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                No projects with billing info.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[70vh]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2.5">Client / project</th>
                      <th className="text-left px-3 py-2.5">Dates</th>
                      <th className="text-left px-3 py-2.5">Status</th>
                      <th className="text-left px-3 py-2.5">Estimate / Invoice</th>
                      <th className="text-left px-3 py-2.5">PO #</th>
                      <th className="text-left px-3 py-2.5">Permit cost</th>
                      <th className="text-left px-3 py-2.5">Days</th>
                      <th className="text-right px-4 py-2.5 print:hidden"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {airtableRows.map((r) => (
                      <tr
                        key={r.id}
                        className="hover:bg-accent/40 cursor-pointer transition-colors"
                        onClick={() => {
                          openNewInvoice(r);
                          void autoQuoteFor(r.id);
                        }}
                        title="Create invoice — plans & Airtable info side by side"
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-medium flex items-center gap-1.5">
                            <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                            {r.company ?? "—"}
                          </div>
                          <div className="text-xs text-muted-foreground truncate max-w-[320px]">
                            {r.jobAddress ?? ""}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                          {fmtDate(r.startDate)} → {fmtDate(r.endDate)}
                        </td>
                        <td className="px-3 py-2.5">
                          {r.status && (
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-[10px]",
                                r.status === "Job Completed - Ready to Bill" &&
                                  "bg-purple-100 text-purple-700",
                                r.status === "Setup Finished - Picked up" &&
                                  "bg-rose-100 text-rose-700",
                              )}
                            >
                              {r.status}
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-medium tabular-nums max-w-[180px] truncate" title={r.estimateInvoice ?? undefined}>
                          {r.estimateInvoice ?? "—"}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{r.poNumber ?? "—"}</td>
                        <td className="px-3 py-2.5 tabular-nums">{r.permitCost ?? "—"}</td>
                        <td className="px-3 py-2.5 tabular-nums">{r.numberOfDays ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right print:hidden">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              openNewInvoice(r);
                            }}
                          >
                            <Receipt className="size-3.5 mr-1" /> Invoice
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "invoices" && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden print:hidden">
          {invoicesQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading invoices…
            </div>
          ) : (invoicesQ.data?.length ?? 0) === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No invoices yet — create one with “New invoice”.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/80 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5">#</th>
                    <th className="text-left px-3 py-2.5">Client</th>
                    <th className="text-left px-3 py-2.5">Issued</th>
                    <th className="text-left px-3 py-2.5">Status</th>
                    <th className="text-right px-3 py-2.5">Total</th>
                    <th className="text-right px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(invoicesQ.data ?? []).map((inv) => (
                    <tr key={inv.id} className="hover:bg-accent/40 transition-colors">
                      <td className="px-4 py-2.5 font-semibold tabular-nums">
                        {inv.invoiceNumber}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium">{inv.clientName}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[280px]">
                          {inv.jobAddress ?? ""}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDate(inv.issueDate)}
                        {inv.dueDate && <> · due {fmtDate(inv.dueDate)}</>}
                      </td>
                      <td className="px-3 py-2.5">
                        <Select
                          value={inv.status}
                          onValueChange={(v) =>
                            setStatus.mutate({ id: inv.id, status: v as any })
                          }
                        >
                          <SelectTrigger
                            className={cn(
                              "h-7 w-[92px] text-[11px] font-semibold border-0",
                              STATUS_BADGE[inv.status] ?? "",
                            )}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">draft</SelectItem>
                            <SelectItem value="sent">sent</SelectItem>
                            <SelectItem value="paid">paid</SelectItem>
                            <SelectItem value="void">void</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                        {money(inv.totalCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs mr-1"
                          onClick={() => setPrinting(inv)}
                        >
                          <Printer className="size-3.5 mr-1" /> View / Print
                        </Button>
                        {inv.status === "draft" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-rose-600 hover:text-rose-700"
                            onClick={() => deleteInvoice.mutate({ id: inv.id })}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

        </>
      )}

      {/* ---- Invoice workspace: editor + plans + Airtable info side by side ---- */}
      {creating && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start print:hidden">
          {/* Left: invoice editor */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-bold">New invoice</h2>
                <p className="text-xs text-muted-foreground">
                  Saved in Fast Traffic OS only — Airtable is never modified.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setCreating(null)}>
                Back to list
              </Button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setJobPickerOpen(true)}
                >
                  <Building2 className="size-4 mr-1" />
                  {creating.jobId ? "Change project" : "Pick project"}
                </Button>
                {creating.jobId && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={autoQuote}
                      disabled={quoting}
                      className="text-primary"
                    >
                      {quoting ? (
                        <Loader2 className="size-4 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="size-4 mr-1" />
                      )}
                      Auto-quote (FTS rules)
                    </Button>
                    <span className="text-xs text-muted-foreground truncate">
                      linked to {creating.clientName}
                    </span>
                  </>
                )}
              </div>
              {quoteReasons.length > 0 && (
                <div className="rounded-md border border-primary/20 bg-primary/5 p-2.5 text-[11px] text-muted-foreground space-y-0.5">
                  <div className="font-semibold text-primary text-xs mb-1">
                    How this quote was built
                  </div>
                  {quoteReasons.map((r, i) => (
                    <div key={i}>· {r}</div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">Client</label>
                  <Input
                    value={creating.clientName}
                    onChange={(e) =>
                      setCreating({ ...creating, clientName: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">Job address</label>
                  <Input
                    value={creating.jobAddress}
                    onChange={(e) =>
                      setCreating({ ...creating, jobAddress: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">Issue date</label>
                  <Input
                    type="date"
                    value={creating.issueDate}
                    onChange={(e) =>
                      setCreating({ ...creating, issueDate: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">Due date (optional)</label>
                  <Input
                    type="date"
                    value={creating.dueDate}
                    onChange={(e) =>
                      setCreating({ ...creating, dueDate: e.target.value })
                    }
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium">Line items</label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() =>
                      setCreating({
                        ...creating,
                        items: [
                          ...creating.items,
                          { description: "", quantity: "1", unit: "" },
                        ],
                      })
                    }
                  >
                    <Plus className="size-3.5 mr-1" /> Add line
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {creating.items.map((it, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Input
                        placeholder="Description"
                        className="h-8 flex-1"
                        value={it.description}
                        onChange={(e) => {
                          const items = [...creating.items];
                          items[i] = { ...it, description: e.target.value };
                          setCreating({ ...creating, items });
                        }}
                      />
                      <Input
                        placeholder="Qty"
                        className="h-8 w-16 text-right"
                        value={it.quantity}
                        onChange={(e) => {
                          const items = [...creating.items];
                          items[i] = { ...it, quantity: e.target.value };
                          setCreating({ ...creating, items });
                        }}
                      />
                      <Input
                        placeholder="$ unit"
                        className="h-8 w-24 text-right"
                        value={it.unit}
                        onChange={(e) => {
                          const items = [...creating.items];
                          items[i] = { ...it, unit: e.target.value };
                          setCreating({ ...creating, items });
                        }}
                      />
                      <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">
                        {money(Math.round((Number(it.quantity) || 0) * (Number(it.unit) || 0) * 100))}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        onClick={() =>
                          setCreating({
                            ...creating,
                            items: creating.items.filter((_, j) => j !== i),
                          })
                        }
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="text-xs font-medium">Notes (PO #, terms…)</label>
                  <Input
                    value={creating.notes}
                    onChange={(e) => setCreating({ ...creating, notes: e.target.value })}
                  />
                </div>
                <div className="flex items-center justify-end gap-4">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-medium">GST %</label>
                    <Input
                      className="h-8 w-16 text-right"
                      value={creating.gstRate}
                      onChange={(e) =>
                        setCreating({ ...creating, gstRate: e.target.value })
                      }
                    />
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-xs text-muted-foreground tabular-nums">
                      Subtotal {money(creatingTotals.sub)} · GST {money(creatingTotals.gst)}
                    </div>
                    <div className="font-bold tabular-nums">
                      Total {money(creatingTotals.total)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setCreating(null)}>
                  Cancel
                </Button>
                <Button onClick={submitInvoice} disabled={createInvoice.isPending}>
                  {createInvoice.isPending && (
                    <Loader2 className="size-4 mr-1 animate-spin" />
                  )}
                  Create invoice
                </Button>
              </div>
            </div>
          </div>

          {/* Right: plans + Airtable info to verify the numbers */}
          <div className="xl:sticky xl:top-4 space-y-3 min-w-0">
            {creating.jobId ? (
              <>
                <div className="rounded-2xl border border-border bg-card overflow-hidden">
                  <div className="flex items-center gap-1.5 flex-wrap px-3 py-2 border-b border-border">
                    {jobDetailQ.isLoading ? (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Loader2 className="size-3.5 animate-spin" /> Loading documents…
                      </span>
                    ) : viewDocs.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        No documents attached in Airtable.
                      </span>
                    ) : (
                      <>
                        {viewDocs.map((d, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setDocIdx(i)}
                            className={cn(
                              "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                              i === docIdx
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:bg-accent",
                            )}
                            title={d.filename ?? undefined}
                          >
                            {d.kind} {i + 1}
                          </button>
                        ))}
                        {viewDocs[docIdx] && (
                          <a
                            href={viewDocs[docIdx].url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto text-[11px] font-medium text-primary hover:underline"
                          >
                            Open in new tab ↗
                          </a>
                        )}
                      </>
                    )}
                  </div>
                  {viewDocs[docIdx] && (
                    <iframe
                      key={viewDocs[docIdx].url}
                      src={viewDocs[docIdx].url}
                      title={viewDocs[docIdx].filename ?? "document"}
                      className="w-full h-[52vh] bg-muted/30"
                    />
                  )}
                </div>

                <div className="rounded-2xl border border-border bg-card overflow-hidden">
                  <div className="px-3 py-2 border-b border-border text-sm font-bold flex items-center gap-2">
                    <FileSpreadsheet className="size-4 text-primary" /> Airtable info
                  </div>
                  <div className="max-h-[34vh] overflow-y-auto">
                    {allFieldsQ.isLoading ? (
                      <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" /> Loading fields…
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <tbody className="divide-y divide-border/60">
                          {(allFieldsQ.data ?? []).map((f) => (
                            <tr key={f.name} className="align-top">
                              <td className="px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap w-[38%]">
                                {f.name}
                              </td>
                              <td className="px-3 py-1.5 break-words">{f.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Pick a project to see its plans and Airtable info here.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---- Project picker (from Airtable accounting rows) ---- */}
      <Dialog open={jobPickerOpen} onOpenChange={setJobPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pick a project</DialogTitle>
            <DialogDescription>
              Prefills client, address and charges from Airtable.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Search client or address…"
            value={jobPickerQ}
            onChange={(e) => setJobPickerQ(e.target.value)}
          />
          <div className="max-h-[300px] overflow-y-auto divide-y divide-border">
            {(airtableQ.data ?? [])
              .filter((r) =>
                `${r.company ?? ""} ${r.jobAddress ?? ""}`
                  .toLowerCase()
                  .includes(jobPickerQ.trim().toLowerCase()),
              )
              .slice(0, 40)
              .map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="w-full text-left px-2 py-2 hover:bg-accent/50 transition-colors"
                  onClick={() => {
                    openNewInvoice(r);
                    setJobPickerOpen(false);
                  }}
                >
                  <div className="text-sm font-medium">{r.company ?? "—"}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.jobAddress ?? ""}
                  </div>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ---- Printable invoice view ---- */}
      <Dialog open={!!printing} onOpenChange={(o) => !o && setPrinting(null)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto print:max-w-none print:max-h-none print:border-0 print:shadow-none">
          {printing && (
            <div id="invoice-print" className="space-y-5 p-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-2xl font-extrabold tracking-tight">
                    Fast Traffic Solutions
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Calgary, Alberta · ftstraffic.ca
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold">{printing.invoiceNumber}</div>
                  <div className="text-xs text-muted-foreground">
                    Issued {fmtDate(printing.issueDate)}
                    {printing.dueDate && <> · Due {fmtDate(printing.dueDate)}</>}
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn("mt-1 uppercase", STATUS_BADGE[printing.status])}
                  >
                    {printing.status}
                  </Badge>
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Bill to
                </div>
                <div className="font-semibold">{printing.clientName}</div>
                {printing.jobAddress && (
                  <div className="text-sm text-muted-foreground">{printing.jobAddress}</div>
                )}
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="text-left py-2">Description</th>
                    <th className="text-right py-2 w-16">Qty</th>
                    <th className="text-right py-2 w-24">Unit</th>
                    <th className="text-right py-2 w-24">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {printing.items.map((it) => (
                    <tr key={it.id}>
                      <td className="py-2">{it.description}</td>
                      <td className="py-2 text-right tabular-nums">{it.quantity}</td>
                      <td className="py-2 text-right tabular-nums">{money(it.unitCents)}</td>
                      <td className="py-2 text-right tabular-nums">{money(it.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end">
                <div className="w-56 space-y-1 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{money(printing.subtotalCents)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>GST ({printing.gstRate}%)</span>
                    <span className="tabular-nums">{money(printing.gstCents)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-base border-t border-border pt-1">
                    <span>Total</span>
                    <span className="tabular-nums">{money(printing.totalCents)}</span>
                  </div>
                </div>
              </div>

              {printing.notes && (
                <div className="text-xs text-muted-foreground border-t border-border pt-2">
                  {printing.notes}
                </div>
              )}

              <div className="flex justify-end gap-2 print:hidden">
                <Button variant="outline" onClick={() => setPrinting(null)}>
                  Close
                </Button>
                <Button onClick={doPrint}>
                  <Printer className="size-4 mr-1" /> Print / Save PDF
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
