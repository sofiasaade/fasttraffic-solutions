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
  HardHat,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { fmtDate, fmtTime12 } from "@/lib/format";
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

// Setup-fee hourly rules (Sofia's matrix) for the quick-correct dropdown.
const SETUP_RULES = [
  { unit: "560.00", label: "Low · <25 signs — 4h · $560", desc: "Setup fee — low impact · <25 signs: 4h × $140/h" },
  { unit: "630.00", label: "Low · 25+ signs — 4.5h · $630", desc: "Setup fee — low impact · 25+ signs: 4.5h × $140/h" },
  { unit: "840.00", label: "Medium — 6h · $840", desc: "Setup fee — medium impact: 6h × $140/h" },
  { unit: "1120.00", label: "High — 8h · $1,120", desc: "Setup fee — high impact: 8h × $140/h" },
] as const;

type NewItem = {
  description: string;
  /** Service lines: quantity. Rental lines: number of DAYS. */
  quantity: string;
  /** Service lines: unit price $. Rental lines: computed (itemQty × rate). */
  unit: string;
  group?: "rental" | "flaggers" | "service";
  /** Rental lines: number of devices (e.g. 16 signs). */
  itemQty?: string;
  /** Rental lines: per-device per-day rate in $ (e.g. 3.00). */
  rate?: string;
};

export default function Accounting() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"airtable" | "billed" | "invoices">("airtable");
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
  // Billed jobs load lazily (900+ records) only when the tab is opened.
  const billedQ = trpc.accounting.airtableBilled.useQuery(undefined, {
    enabled: unlocked && tab === "billed",
    staleTime: 10 * 60 * 1000,
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

  // Jobs that already have an FTS invoice -> show a colored tag on the list.
  const invoicedByJob = useMemo(() => {
    const m = new Map<string, { number: string; status: string }>();
    for (const inv of invoicesQ.data ?? []) {
      if (inv.airtableJobId && !m.has(inv.airtableJobId)) {
        m.set(inv.airtableJobId, { number: inv.invoiceNumber, status: inv.status });
      }
    }
    return m;
  }, [invoicesQ.data]);

  // Numeric part of a job's linked invoice number (for invoice-order sorting).
  const invoiceNumOf = (jobId: string) => {
    const n = invoicedByJob.get(jobId)?.number.match(/(\d+)$/)?.[1];
    return n ? Number(n) : -1;
  };

  // ---- Airtable table (read-only) ----
  const READY = "Job Completed - Ready to Bill";
  const PICKED = "Setup Finished - Picked up";
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "picked">(
    "all",
  );
  // Second dimension: jobs that already have an FTS invoice vs not.
  const [invoiceFilter, setInvoiceFilter] = useState<"all" | "invoiced" | "not">(
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
    if (invoiceFilter === "invoiced") rows = rows.filter((r) => invoicedByJob.has(r.id));
    if (invoiceFilter === "not") rows = rows.filter((r) => !invoicedByJob.has(r.id));
    const ql = q.trim().toLowerCase();
    if (ql) {
      rows = rows.filter((r) =>
        `${r.company ?? ""} ${r.jobAddress ?? ""} ${r.estimateInvoice ?? ""} ${r.poNumber ?? ""}`
          .toLowerCase()
          .includes(ql),
      );
    }
    // Invoiced filter active → newest invoice number first.
    if (invoiceFilter === "invoiced") {
      return [...rows].sort((a, b) => invoiceNumOf(b.id) - invoiceNumOf(a.id));
    }
    // Ready to Bill first, then Picked up; OLDEST first inside each group
    // (bill the oldest work first).
    const groupOf = (s: string | null) => (s === READY ? 0 : 1);
    return [...rows].sort((a, b) => {
      const g = groupOf(a.status) - groupOf(b.status);
      if (g !== 0) return g;
      return (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999");
    });
  }, [airtableQ.data, q, statusFilter, invoiceFilter, invoicedByJob]);

  const billedRows = useMemo(() => {
    let rows = billedQ.data ?? [];
    if (invoiceFilter === "invoiced") rows = rows.filter((r) => invoicedByJob.has(r.id));
    if (invoiceFilter === "not") rows = rows.filter((r) => !invoicedByJob.has(r.id));
    const ql = q.trim().toLowerCase();
    if (ql) {
      rows = rows.filter((r) =>
        `${r.company ?? ""} ${r.jobAddress ?? ""} ${r.estimateInvoice ?? ""} ${r.poNumber ?? ""}`
          .toLowerCase()
          .includes(ql),
      );
    }
    // Invoiced filter active → newest invoice number first; else oldest first.
    if (invoiceFilter === "invoiced") {
      return [...rows].sort((a, b) => invoiceNumOf(b.id) - invoiceNumOf(a.id));
    }
    return [...rows].sort((a, b) =>
      (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"),
    );
  }, [billedQ.data, q, invoiceFilter, invoicedByJob]);

  // Active list for the Airtable/Billed tabs.
  const listRows = tab === "billed" ? billedRows : airtableRows;
  const listLoading = tab === "billed" ? billedQ.isLoading : airtableQ.isLoading;

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
  // Editing an existing invoice reuses the same workspace.
  const [editingInvoiceId, setEditingInvoiceId] = useState<number | null>(null);
  // Rental discount percentage (open — any %, default 25).
  const [discountPct, setDiscountPct] = useState("25");
  const updateInvoice = trpc.accounting.updateInvoice.useMutation({
    onSuccess: (r) => {
      toast.success(`Invoice ${r.invoiceNumber} updated`);
      setCreating(null);
      setEditingInvoiceId(null);
      utils.accounting.listInvoices.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  /** Open an existing invoice in the editor (rental lines re-expand into columns). */
  const openEditInvoice = (inv: NonNullable<typeof invoicesQ.data>[number]) => {
    const items: NewItem[] = inv.items.map((it) => {
      const fh = it.description.match(/^(.+) × (\d+(?:\.\d+)?) — \$([\d.]+)\/h$/);
      if (fh) {
        return {
          description: fh[1],
          quantity: String(it.quantity), // hours
          unit: "",
          group: "flaggers" as const,
          itemQty: fh[2],
          rate: fh[3],
        };
      }
      const m = it.description.match(/^(.+) × (\d+(?:\.\d+)?) — \$([\d.]+)\/day$/);
      if (m) {
        return {
          description: m[1],
          quantity: String(it.quantity), // days
          unit: (it.unitCents / 100).toFixed(2),
          group: "rental" as const,
          itemQty: m[2],
          rate: m[3],
        };
      }
      return {
        description: it.description,
        quantity: String(it.quantity),
        unit: (it.unitCents / 100).toFixed(2),
        group: "service" as const,
      };
    });
    setQuoteReasons([]);
    setLastQuote(null);
    setDocIdx(0);
    setSignCheckOn(false);
    setEditingInvoiceId(inv.id);
    setCreating({
      jobId: inv.airtableJobId ?? null,
      clientName: inv.clientName,
      jobAddress: inv.jobAddress ?? "",
      issueDate: inv.issueDate,
      dueDate: inv.dueDate ?? "",
      gstRate: String(inv.gstRate),
      notes: inv.notes ?? "",
      items,
    });
    setTab("invoices");
  };

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
          group: /rental|boards/i.test(label) ? "rental" : "service",
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
      items.push({ description: "Traffic control services", quantity: "1", unit: "", group: "service" });
    }
    setQuoteReasons([]);
    setLastQuote(null);
    setDocIdx(0);
    setSignCheckOn(false);
    setEditingInvoiceId(null);
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
  // Last auto-quote lines, stored with the invoice so Claude can learn from
  // whatever the biller changed before creating it.
  const [lastQuote, setLastQuote] = useState<
    { description: string; quantity: number; unitCents: number }[] | null
  >(null);
  const autoQuoteFor = async (jobId: string) => {
    setQuoting(true);
    try {
      const q = await utils.accounting.suggestQuote.fetch({ jobId });
      setCreating((prev) =>
        prev
          ? {
              ...prev,
              items: q.lines.map((l) => {
                if (/^Flaggers/.test(l.description)) {
                  const rate = l.unitCents / 100;
                  return {
                    description: rate >= 60 ? "Flaggers — Overtime (1.5×)" : "Flaggers — Regular time",
                    quantity: String(l.quantity), // hours
                    unit: "",
                    group: "flaggers" as const,
                    itemQty: "1",
                    rate: rate.toFixed(2),
                  };
                }
                return {
                description: l.description,
                quantity: String(l.quantity),
                unit: (l.unitCents / 100).toFixed(2),
                group: ((l as any).section ?? "service") as "rental" | "service",
                itemQty:
                  (l as any).itemQty != null ? String((l as any).itemQty) : undefined,
                rate:
                  (l as any).rateCents != null
                    ? ((l as any).rateCents / 100).toFixed(2)
                    : undefined,
                };
              }),
            }
          : prev,
      );
      setQuoteReasons(q.reasons);
      setLastQuote(
        q.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitCents: l.unitCents,
        })),
      );
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
  const opsQ = trpc.accounting.jobOperations.useQuery(
    { jobId: workJobId },
    { enabled: !!workJobId },
  );
  // Signs Count vs plan legend — runs on demand (downloads + parses the PDF).
  const [signCheckOn, setSignCheckOn] = useState(false);
  const signCheckQ = trpc.accounting.verifySigns.useQuery(
    { jobId: workJobId },
    { enabled: !!workJobId && signCheckOn, staleTime: 10 * 60 * 1000 },
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
      if ((it.group === "rental" || it.group === "flaggers") && it.itemQty != null) {
        return (
          n +
          Math.round(
            (Number(it.itemQty) || 0) *
              (Number(it.rate) || 0) *
              (Number(it.quantity) || 0) *
              100,
          )
        );
      }
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
      .map((it) => {
        if ((it.group === "rental" || it.group === "flaggers") && it.itemQty != null) {
          const n = Number(it.itemQty) || 0;
          const rate = Number(it.rate) || 0;
          const days = Number(it.quantity) || 0;
          if (!it.description.trim() || n <= 0 || rate <= 0 || days <= 0) return null;
          const per = it.group === "flaggers" ? "h" : "day";
          return {
            description: `${it.description.trim()} × ${n} — $${rate.toFixed(2)}/${per}`,
            quantity: days,
            unitCents: Math.round(n * rate * 100),
          };
        }
        if (!it.description.trim() || !(Number(it.quantity) > 0) || Number(it.unit) === 0 || !Number.isFinite(Number(it.unit)))
          return null;
        return {
          description: it.description.trim(),
          quantity: Number(it.quantity),
          unitCents: Math.round(Number(it.unit) * 100),
        };
      })
      .filter((x): x is { description: string; quantity: number; unitCents: number } => !!x);
    if (!creating.clientName.trim()) return toast.error("Client name is required");
    if (items.length === 0) return toast.error("Add at least one line with an amount");
    if (editingInvoiceId != null) {
      updateInvoice.mutate({
        id: editingInvoiceId,
        clientName: creating.clientName.trim(),
        jobAddress: creating.jobAddress.trim() || null,
        issueDate: creating.issueDate,
        dueDate: creating.dueDate || null,
        gstRate: Number(creating.gstRate) || 0,
        notes: creating.notes.trim() || null,
        items,
      });
      return;
    }
    createInvoice.mutate({
      airtableJobId: creating.jobId,
      clientName: creating.clientName.trim(),
      jobAddress: creating.jobAddress.trim() || null,
      issueDate: creating.issueDate,
      dueDate: creating.dueDate || null,
      gstRate: Number(creating.gstRate) || 0,
      notes: creating.notes.trim() || null,
      items,
      suggested: lastQuote,
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
            variant={tab === "billed" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("billed")}
          >
            <FileSpreadsheet className="size-4 mr-1" /> Billed
            {billedQ.data && (
              <span className="ml-1.5 rounded-full bg-primary-foreground/20 px-1.5 text-[10px] tabular-nums">
                {billedQ.data.length}
              </span>
            )}
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

      {(tab === "airtable" || tab === "billed") && (
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
            {tab === "airtable" && (
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
              {(() => {
                const source = airtableQ.data;
                const inv = (source ?? []).filter((r) => invoicedByJob.has(r.id)).length;
                const not = (source?.length ?? 0) - inv;
                return (
                  <>
                    <span className="mx-1 h-5 w-px bg-border" />
                    <button
                      type="button"
                      onClick={() =>
                        setInvoiceFilter(invoiceFilter === "invoiced" ? "all" : "invoiced")
                      }
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors",
                        invoiceFilter === "invoiced"
                          ? "bg-emerald-600 text-white"
                          : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200",
                      )}
                    >
                      ✓ Invoiced ({inv})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setInvoiceFilter(invoiceFilter === "not" ? "all" : "not")
                      }
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors",
                        invoiceFilter === "not"
                          ? "bg-slate-600 text-white"
                          : "bg-muted text-muted-foreground hover:bg-accent",
                      )}
                    >
                      No invoice ({not})
                    </button>
                  </>
                );
              })()}
            </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            {listLoading ? (
              <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading Airtable accounting…
              </div>
            ) : listRows.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                No projects with billing info.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[70vh]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2.5">Client / project</th>
                      <th className="text-left px-3 py-2.5">Days</th>
                      <th className="text-left px-3 py-2.5">Dates</th>
                      <th className="text-left px-3 py-2.5">Status</th>
                      <th className="text-left px-3 py-2.5">Estimate / Invoice</th>
                      <th className="text-right px-4 py-2.5 print:hidden"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {listRows.map((r) => (
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
                          <div className="font-medium flex items-center gap-1.5 flex-wrap">
                            <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                            {r.company ?? "—"}
                            {invoicedByJob.has(r.id) && (
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                  invoicedByJob.get(r.id)!.status === "paid"
                                    ? "bg-green-100 text-green-700"
                                    : "bg-emerald-100 text-emerald-700",
                                )}
                                title={`Invoice ${invoicedByJob.get(r.id)!.number} (${invoicedByJob.get(r.id)!.status})`}
                              >
                                ✓ {invoicedByJob.get(r.id)!.number}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground truncate max-w-[320px]">
                            {r.jobAddress ?? ""}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums font-semibold">
                          {r.numberOfDays ?? "—"}
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
                        {inv.status !== "paid" && inv.status !== "void" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs mr-1"
                            onClick={() => openEditInvoice(inv)}
                          >
                            Edit
                          </Button>
                        )}
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
                <h2 className="font-bold">
                  {editingInvoiceId != null ? "Edit invoice" : "New invoice"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  Saved in Fast Traffic OS only — Airtable is never modified.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCreating(null);
                  setEditingInvoiceId(null);
                }}
              >
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

              {(["rental", "flaggers", "service"] as const).map((group) => {
                const lineTotal = (it: NewItem) =>
                  (it.group === "rental" || it.group === "flaggers") && it.itemQty != null
                    ? Math.round(
                        (Number(it.itemQty) || 0) *
                          (Number(it.rate) || 0) *
                          (Number(it.quantity) || 0) *
                          100,
                      )
                    : Math.round(
                        (Number(it.quantity) || 0) * (Number(it.unit) || 0) * 100,
                      );
                const groupTotal = creating.items.reduce(
                  (n, it) => ((it.group ?? "service") === group ? n + lineTotal(it) : n),
                  0,
                );
                return (
                  <div key={group}>
                    <div className="flex items-center justify-between mb-1">
                      <label
                        className={cn(
                          "text-xs font-bold uppercase tracking-wide",
                          group === "rental"
                            ? "text-blue-700"
                            : group === "flaggers"
                              ? "text-orange-700"
                              : "text-purple-700",
                        )}
                      >
                        {group === "rental"
                          ? "Sign & equipment rental"
                          : group === "flaggers"
                            ? "Flaggers"
                            : "Charges & services"}
                        <span className="ml-2 font-semibold normal-case tabular-nums text-muted-foreground">
                          {money(groupTotal)}
                        </span>
                      </label>
                      {group === "flaggers" ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-orange-700"
                            onClick={() =>
                              setCreating({
                                ...creating,
                                items: [
                                  ...creating.items,
                                  { description: "Flaggers — Regular time", quantity: "8", unit: "", group, itemQty: "1", rate: "40.00" },
                                ],
                              })
                            }
                          >
                            <Plus className="size-3.5 mr-1" /> Regular ($40/h)
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-orange-700"
                            onClick={() => {
                              const reg = creating.items.find(
                                (x) => x.group === "flaggers" && /regular/i.test(x.description),
                              );
                              const otRate = ((Number(reg?.rate) || 40) * 1.5).toFixed(2);
                              setCreating({
                                ...creating,
                                items: [
                                  ...creating.items,
                                  { description: "Flaggers — Overtime (1.5×)", quantity: "1", unit: "", group, itemQty: "1", rate: otRate },
                                ],
                              });
                            }}
                          >
                            <Plus className="size-3.5 mr-1" /> Overtime (1.5×)
                          </Button>
                        </div>
                      ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          setCreating({
                            ...creating,
                            items: [
                              ...creating.items,
                              group === "rental"
                                ? { description: "", quantity: "1", unit: "", group, itemQty: "1", rate: "" }
                                : { description: "", quantity: "1", unit: "", group },
                            ],
                          })
                        }
                      >
                        <Plus className="size-3.5 mr-1" /> Add line
                      </Button>
                      )}
                    </div>
                    <div
                      className={cn(
                        "space-y-1.5 rounded-lg border p-2 mb-2",
                        group === "rental"
                          ? "border-blue-200 bg-blue-50/40"
                          : group === "flaggers"
                            ? "border-orange-200 bg-orange-50/40"
                            : "border-purple-200 bg-purple-50/40",
                      )}
                    >
                      {/* Column headers */}
                      <div className="flex items-center gap-1.5 px-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                        <span className="flex-1 min-w-[140px]">Description</span>
                        {group === "rental" ? (
                          <>
                            <span className="w-14 text-right"># Signs</span>
                            <span className="w-20 text-right">$/day</span>
                            <span className="w-14 text-right">Days</span>
                          </>
                        ) : group === "flaggers" ? (
                          <>
                            <span className="w-14 text-right"># Flag.</span>
                            <span className="w-20 text-right">$/hr</span>
                            <span className="w-14 text-right">Hours</span>
                          </>
                        ) : (
                          <>
                            <span className="w-16 text-right">Qty</span>
                            <span className="w-24 text-right">$ Unit</span>
                          </>
                        )}
                        <span className="w-20 text-right">Total</span>
                        <span className="w-7" />
                      </div>
                      {creating.items.filter((it) => (it.group ?? "service") === group)
                        .length === 0 && (
                        <div className="text-[11px] text-muted-foreground px-1 py-0.5">
                          {group === "flaggers"
                            ? "No flaggers — 8 regular hours per day; past 8h is overtime at 1.5×."
                            : "No lines — use “Add line”."}
                        </div>
                      )}
                      {creating.items.map((it, i) => {
                        if ((it.group ?? "service") !== group) return null;
                        const upd = (patch: Partial<NewItem>) => {
                          const items = [...creating.items];
                          items[i] = { ...it, ...patch };
                          setCreating({ ...creating, items });
                        };
                        const isRental = (group === "rental" || group === "flaggers") && it.itemQty != null;
                        return (
                          <div key={i} className="space-y-1">
                            <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
                            <Input
                              placeholder="Description"
                              className="h-8 flex-1 min-w-[140px] bg-background"
                              value={it.description}
                              onChange={(e) => upd({ description: e.target.value })}
                            />
                            {isRental ? (
                              <>
                                <Input
                                  placeholder="#"
                                  title="Number of signs / devices"
                                  className="h-8 w-14 text-right bg-background"
                                  value={it.itemQty}
                                  onChange={(e) => upd({ itemQty: e.target.value })}
                                />
                                <Input
                                  placeholder="$/day"
                                  title="Rate per device per day"
                                  className="h-8 w-20 text-right bg-background"
                                  value={it.rate}
                                  onChange={(e) => upd({ rate: e.target.value })}
                                />
                                <Input
                                  placeholder="Days"
                                  title="Days billed"
                                  className="h-8 w-14 text-right bg-background"
                                  value={it.quantity}
                                  onChange={(e) => upd({ quantity: e.target.value })}
                                />
                              </>
                            ) : (
                              <>
                                <Input
                                  placeholder="Qty"
                                  className="h-8 w-16 text-right bg-background"
                                  value={it.quantity}
                                  onChange={(e) => upd({ quantity: e.target.value })}
                                />
                                <Input
                                  placeholder="$ unit"
                                  className="h-8 w-24 text-right bg-background"
                                  value={it.unit}
                                  onChange={(e) => upd({ unit: e.target.value })}
                                />
                              </>
                            )}
                            <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">
                              {money(lineTotal(it))}
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
                            {group === "service" &&
                              /^Setup fee/.test(it.description) && (
                                <div className="flex items-center gap-1.5 pl-2">
                                  <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                                    Rule
                                  </span>
                                  <Select
                                    value={
                                      SETUP_RULES.find((r) => r.unit === it.unit)?.unit ??
                                      "custom"
                                    }
                                    onValueChange={(v) => {
                                      const r = SETUP_RULES.find((x) => x.unit === v);
                                      if (r) upd({ description: r.desc, unit: r.unit });
                                    }}
                                  >
                                    <SelectTrigger className="h-7 w-64 text-[11px] bg-background">
                                      <SelectValue placeholder="Custom amount" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {SETUP_RULES.map((r) => (
                                        <SelectItem key={r.unit} value={r.unit}>
                                          {r.label}
                                        </SelectItem>
                                      ))}
                                      <SelectItem value="custom" disabled>
                                        Custom amount (edit $ Unit)
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                          </div>
                        );
                      })}
                      {group === "rental" &&
                        (() => {
                          const isDiscountLine = (d: string) =>
                            /rental discount \([\d.]+%\)/i.test(d);
                          const existing = creating.items.find((it) =>
                            isDiscountLine(it.description),
                          );
                          const toggleDiscount = () => {
                            if (existing) {
                              setCreating({
                                ...creating,
                                items: creating.items.filter(
                                  (it) => !isDiscountLine(it.description),
                                ),
                              });
                              return;
                            }
                            const pct = Number(discountPct) || 0;
                            if (pct <= 0 || pct >= 100) return;
                            const base = creating.items.reduce(
                              (n, it) =>
                                (it.group ?? "service") === "rental" &&
                                !isDiscountLine(it.description)
                                  ? n + lineTotal(it)
                                  : n,
                              0,
                            );
                            setCreating({
                              ...creating,
                              items: [
                                ...creating.items,
                                {
                                  description: `Signs rental discount (${pct}%)`,
                                  quantity: "1",
                                  unit: (-(base * (pct / 100)) / 100).toFixed(2),
                                  group: "rental",
                                },
                              ],
                            });
                          };
                          return (
                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-blue-200 pt-1.5 text-[11px] tabular-nums">
                              <div className="flex items-center gap-1.5">
                                {!existing && (
                                  <span className="flex items-center gap-1">
                                    <Input
                                      value={discountPct}
                                      onChange={(e) => setDiscountPct(e.target.value)}
                                      className="h-6 w-12 px-1 text-right text-[11px] bg-background"
                                      title="Discount percentage"
                                    />
                                    <span className="text-muted-foreground">%</span>
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={toggleDiscount}
                                  className={cn(
                                    "rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors",
                                    existing
                                      ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
                                      : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100",
                                  )}
                                >
                                  {existing
                                    ? `✕ Remove discount`
                                    : `− Apply discount`}
                                </button>
                              </div>
                              <span className="font-bold text-blue-800">
                                Rental subtotal: {money(groupTotal)}
                              </span>
                            </div>
                          );
                        })()}
                    </div>
                  </div>
                );
              })}

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
                <Button
                  onClick={submitInvoice}
                  disabled={createInvoice.isPending || updateInvoice.isPending}
                >
                  {(createInvoice.isPending || updateInvoice.isPending) && (
                    <Loader2 className="size-4 mr-1 animate-spin" />
                  )}
                  {editingInvoiceId != null ? "Save changes" : "Create invoice"}
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

                {/* Operational results: who worked which day, times, novedades, flagging */}
                <div className="rounded-2xl border border-border bg-card overflow-hidden">
                  <div className="px-3 py-2 border-b border-border text-sm font-bold flex items-center gap-2">
                    <HardHat className="size-4 text-primary" /> Field operations
                  </div>
                  <div className="max-h-[30vh] overflow-y-auto p-3 space-y-3 text-xs">
                    {opsQ.isLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" /> Loading operations…
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="font-bold uppercase tracking-wide text-[10px] text-muted-foreground mb-1">
                            Technicians by day
                          </div>
                          {(opsQ.data?.assignments ?? []).length === 0 ? (
                            <div className="text-muted-foreground">
                              No technician assignments recorded.
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              {(opsQ.data?.assignments ?? []).map((a: any) => (
                                <div key={a.id} className="flex flex-wrap items-center gap-x-1.5">
                                  <span className="font-semibold tabular-nums">
                                    {a.scheduledDate ? fmtDate(a.scheduledDate) : "General"}
                                  </span>
                                  <span>· {a.technicianName}</span>
                                  <span className="text-muted-foreground">· {a.phase}</span>
                                  {a.startTime && (
                                    <span className="text-muted-foreground">
                                      · {fmtTime12(a.startTime)}
                                      {a.endTime ? ` – ${fmtTime12(a.endTime)}` : ""}
                                    </span>
                                  )}
                                  {a.completedAt && (
                                    <span className="text-green-700 font-medium">
                                      ✓ done {new Date(a.completedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                                    </span>
                                  )}
                                  {a.note && (
                                    <span className="text-amber-700">📝 {a.note}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="font-bold uppercase tracking-wide text-[10px] text-muted-foreground mb-1">
                            Flagging
                          </div>
                          {(opsQ.data?.flagging ?? []).length === 0 ? (
                            <div className="text-muted-foreground">No flagging logged.</div>
                          ) : (
                            <div className="space-y-0.5">
                              {(opsQ.data?.flagging ?? []).map((f: any) => (
                                <div key={f.id} className="flex flex-wrap gap-x-1.5">
                                  <span className="font-semibold tabular-nums">{fmtDate(f.workDate)}</span>
                                  <span>· {f.technicianName}</span>
                                  <span className="tabular-nums">· {f.hours}h</span>
                                  <span className="text-muted-foreground tabular-nums">
                                    × {money(f.hourlyRateCents ?? 4000)}/h
                                  </span>
                                </div>
                              ))}
                              <div className="font-bold text-orange-700 tabular-nums">
                                Total: {opsQ.data?.flaggingHoursTotal}h · {money(opsQ.data?.flaggingAmountCents ?? 0)}
                                <span className="font-normal text-muted-foreground"> — added by auto-quote</span>
                              </div>
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <div className="font-bold uppercase tracking-wide text-[10px] text-muted-foreground">
                              Signs Count vs Plan
                            </div>
                            {!signCheckOn && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-[10px]"
                                onClick={() => setSignCheckOn(true)}
                              >
                                Verify against plan
                              </Button>
                            )}
                          </div>
                          {signCheckOn &&
                            (signCheckQ.isLoading ? (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="size-3.5 animate-spin" /> Reading the plan PDF…
                              </div>
                            ) : (signCheckQ.data?.rows.length ?? 0) === 0 ? (
                              <div className="text-muted-foreground">
                                No sign list to compare (missing Signs Count or plan PDF).
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                {signCheckQ.data!.rows.map((r, i) => (
                                  <div key={i} className="flex flex-wrap items-center gap-x-1.5">
                                    <span
                                      className={cn(
                                        "font-bold",
                                        r.verdict === "match" && "text-green-700",
                                        r.verdict === "differs" && "text-rose-700",
                                        r.verdict === "not_found" && "text-muted-foreground",
                                        r.verdict === "drawn" && "text-blue-700",
                                      )}
                                    >
                                      {r.verdict === "match"
                                        ? "✓"
                                        : r.verdict === "differs"
                                          ? "⚠"
                                          : r.verdict === "drawn"
                                            ? "●"
                                            : "?"}
                                    </span>
                                    <span>{r.label}</span>
                                    <span className="tabular-nums text-muted-foreground">
                                      field {r.fieldQty}
                                      {r.verdict === "differs" && ` · plan says ${r.planQty}`}
                                      {r.verdict === "not_found" && " · not in plan text"}
                                      {r.verdict === "drawn" && " · drawn as dots — check visually"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ))}
                        </div>

                        <div>
                          <div className="font-bold uppercase tracking-wide text-[10px] text-muted-foreground mb-1">
                            Novedades
                          </div>
                          {(opsQ.data?.notes ?? []).length === 0 ? (
                            <div className="text-muted-foreground">No field notes.</div>
                          ) : (
                            <div className="space-y-1">
                              {(opsQ.data?.notes ?? []).map((n: any) => (
                                <div key={n.id} className="flex items-start gap-1.5">
                                  <span
                                    className={cn(
                                      "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                                      n.category === "stolen" && "bg-rose-100 text-rose-700",
                                      n.category === "lost" && "bg-amber-100 text-amber-700",
                                      n.category === "damaged" && "bg-orange-100 text-orange-700",
                                      (!n.category || n.category === "general") &&
                                        "bg-muted text-muted-foreground",
                                    )}
                                  >
                                    {n.category ?? "note"}
                                  </span>
                                  <span className="min-w-0">
                                    {n.note ?? n.text ?? ""}
                                    <span className="text-muted-foreground">
                                      {" "}— {n.authorName ?? n.technicianName ?? ""}
                                    </span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
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
