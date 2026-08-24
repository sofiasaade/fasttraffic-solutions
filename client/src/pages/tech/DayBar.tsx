import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Truck,
  LogOut,
  ShieldAlert,
  CheckCircle2,
  ClipboardCheck,
  Wrench,
  MapPin,
  Warehouse,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  FITNESS_OPTIONS,
  PPE_ITEMS,
  PPE_STATES,
  COMMS_ITEMS,
  VEHICLE_INSPECTION_SECTIONS,
  type PpeState,
} from "@shared/safetyForms";

const PPE_STATE_LABEL: Record<PpeState, string> = {
  available: "✓ Available",
  missing: "✗ Missing",
  damaged: "🔧 Damaged",
  replacement_requested: "↻ Replacement requested",
  na: "N/A",
};
const PPE_STATE_CLS: Record<PpeState, string> = {
  available: "border-emerald-300 bg-emerald-50 text-emerald-800",
  missing: "border-rose-300 bg-rose-50 text-rose-800",
  damaged: "border-amber-300 bg-amber-50 text-amber-900",
  replacement_requested: "border-blue-300 bg-blue-50 text-blue-800",
  na: "border-border bg-muted text-muted-foreground",
};

type Resp = "pass" | "defect" | "na" | "not_inspected";

type DefectDraft = {
  category: string;
  itemKey: string;
  itemLabel: string;
  severity: "minor" | "major" | "critical";
  description: string;
  taggedOut: boolean;
};

/**
 * "My Day" — the technician's staged daily workflow (COR Phase 1):
 * Start Day (paid time, never blocked) → Start-of-day confirmation →
 * Vehicle pre-use inspection → Depart warehouse → Arrive at site →
 * Return to warehouse → End day. Critical defects show DO NOT OPERATE and
 * block departure; safety paperwork never blocks the paid check-in itself.
 */
export default function DayBar() {
  const utils = trpc.useUtils();
  const q = trpc.technician.dayStatus.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const dayQ = trpc.safety.myDay.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const [truck, setTruck] = useState<string>("");
  const [sodOpen, setSodOpen] = useState(false);
  const [vehOpen, setVehOpen] = useState(false);

  const invalidate = () => {
    utils.technician.dayStatus.invalidate();
    utils.safety.myDay.invalidate();
  };

  const start = trpc.technician.startDay.useMutation({
    onSuccess: () => {
      toast.success("Day started — paid time is running.");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const end = trpc.technician.endDay.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success("Checked out. See you tomorrow!");
      else
        toast.error(
          `Hazard assessment missing for: ${r.missingHazards.join(", ")}.`,
          { duration: 8000 },
        );
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const depart = trpc.safety.departWarehouse.useMutation({
    onSuccess: () => {
      toast.success("Departed warehouse — travel safe.");
      invalidate();
    },
    onError: (e) => toast.error(e.message, { duration: 8000 }),
  });
  const arrive = trpc.safety.arriveSite.useMutation({
    onSuccess: () => {
      toast.success("Arrival recorded. Complete the site safety steps.");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const returnWh = trpc.safety.returnWarehouse.useMutation({
    onSuccess: () => {
      toast.success("Back at the warehouse.");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const d = q.data;
  const day = dayQ.data;
  if (!d) return null;

  // Not checked in yet → truck picker (paid time starts here, ungated).
  if (!d.session) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm mb-4">
        <div className="flex items-center gap-2 font-bold text-sm mb-2">
          <Truck className="size-4 text-primary" /> Start Day / Check In
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Pick your truck and check in — this starts your paid time. Safety
          steps come right after.
        </p>
        <div className="flex gap-2">
          <Select value={truck} onValueChange={setTruck}>
            <SelectTrigger className="h-10 flex-1">
              <SelectValue placeholder="Choose a truck…" />
            </SelectTrigger>
            <SelectContent>
              {d.trucks.map((t) => (
                <SelectItem key={t.name} value={t.name}>
                  {t.name}
                  {t.ref ? ` · ${t.ref}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className="h-10"
            disabled={!truck || start.isPending}
            onClick={() => {
              const t = d.trucks.find((x) => x.name === truck);
              start.mutate({ truckName: truck, truckCode: t?.code ?? null });
            }}
          >
            Check in
          </Button>
        </div>
      </div>
    );
  }

  const done = !!d.session.checkOutAt;
  const sodDone = !!day?.startOfDayDone;
  const vehDone = !!day?.vehicleInspectionDone;
  const departed = !!day?.departedAt;
  const arrived = !!day?.arrivedAt;
  const returned = !!day?.returnedAt;
  const doNotOperate = !!day?.doNotOperate;

  const steps = [
    { key: "sod", label: "Start-of-day confirmation", ok: sodDone },
    { key: "veh", label: "Vehicle inspection", ok: vehDone },
    { key: "depart", label: "Depart warehouse", ok: departed },
    { key: "return", label: "Return to warehouse", ok: returned },
    { key: "end", label: "End day", ok: done },
  ];
  const doneCount = steps.filter((s) => s.ok).length;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm mb-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-bold text-sm">
            <Truck className="size-4 text-primary" />
            <span className="truncate">
              {d.session.truckName ?? "No truck"}
              {d.session.truckCode ? ` (${d.session.truckCode})` : ""}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {done
              ? "Day complete — checked out."
              : `My Day · ${doneCount} of ${steps.length} steps complete`}
          </div>
        </div>
        {done && <CheckCircle2 className="size-5 text-green-600 shrink-0" />}
      </div>

      {/* DO NOT OPERATE — a critical defect is open on this truck */}
      {!done && doNotOperate && (
        <div className="mt-3 rounded-xl border-2 border-rose-400 bg-rose-50 px-3 py-2.5 text-rose-900">
          <div className="font-extrabold text-sm">🚫 DO NOT OPERATE</div>
          <div className="text-[12px]">
            {d.session.truckName} has an open CRITICAL defect. Your supervisor
            was notified — the vehicle cannot be released until an authorized
            repair/release.
          </div>
        </div>
      )}

      {!done && (
        <div className="mt-3 grid grid-cols-1 gap-2">
          {/* Step: start-of-day confirmation */}
          <StepButton
            icon={ClipboardCheck}
            label="Start-of-day confirmation"
            done={sodDone}
            onClick={() => setSodOpen(true)}
          />
          {/* Step: vehicle inspection */}
          <StepButton
            icon={Wrench}
            label={`Vehicle inspection — ${d.session.truckName ?? "truck"}`}
            done={vehDone}
            onClick={() => setVehOpen(true)}
          />
          {/* Step: depart / arrive / return */}
          {!departed ? (
            <Button
              className="h-11 justify-start"
              variant="outline"
              disabled={!sodDone || !vehDone || doNotOperate || depart.isPending}
              onClick={() => depart.mutate()}
            >
              <MapPin className="size-4 mr-2" /> Depart warehouse
              {(!sodDone || !vehDone) && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  complete steps above first
                </span>
              )}
            </Button>
          ) : !arrived ? (
            <Button
              className="h-11 justify-start"
              variant="outline"
              disabled={arrive.isPending}
              onClick={() => arrive.mutate()}
            >
              <MapPin className="size-4 mr-2" /> Arrived at site
            </Button>
          ) : !returned ? (
            <Button
              className="h-11 justify-start"
              variant="outline"
              disabled={returnWh.isPending}
              onClick={() => returnWh.mutate()}
            >
              <Warehouse className="size-4 mr-2" /> Return to warehouse
            </Button>
          ) : null}
          {/* End day */}
          <Button
            className="h-11"
            variant={d.canCheckOut ? "default" : "outline"}
            disabled={end.isPending}
            onClick={() => end.mutate()}
          >
            <LogOut className="size-4 mr-2" /> End Day / Check Out
          </Button>
        </div>
      )}

      {/* Hazard gate warning (end-of-day) */}
      {!done && d.missingHazardCount > 0 && (
        <div className="flex items-center gap-1.5 mt-3 rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-[12px] font-medium">
          <ShieldAlert className="size-4 shrink-0" />
          {d.missingHazardCount} hazard assessment
          {d.missingHazardCount === 1 ? "" : "s"} pending — required before you
          can check out.
        </div>
      )}

      {sodOpen && (
        <StartOfDayDialog
          onClose={() => setSodOpen(false)}
          onDone={() => {
            setSodOpen(false);
            invalidate();
          }}
        />
      )}
      {vehOpen && (
        <VehicleInspectionDialog
          truckName={d.session.truckName ?? "—"}
          onClose={() => setVehOpen(false)}
          onDone={() => {
            setVehOpen(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function StepButton({
  icon: Icon,
  label,
  done,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  done: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 h-11 rounded-lg border px-3 text-sm font-medium transition-colors text-left",
        done
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "border-border bg-background hover:bg-accent",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {done ? (
        <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
      ) : (
        <span className="text-[10px] font-bold uppercase text-primary shrink-0">
          To do
        </span>
      )}
    </button>
  );
}

/* ---------------------- Start-of-day confirmation ---------------------- */

function StartOfDayDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [fitness, setFitness] = useState<string>("fit");
  const [ppe, setPpe] = useState<Record<string, PpeState>>(() =>
    Object.fromEntries(PPE_ITEMS.map((p) => [p.key, "available" as PpeState])),
  );
  const [comms, setComms] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(COMMS_ITEMS.map((c) => [c.key, true])),
  );
  const [toolbox, setToolbox] = useState(false);
  const [uuid] = useState(() => crypto.randomUUID());

  const submit = trpc.safety.submitForm.useMutation({
    onSuccess: () => {
      toast.success("Start-of-day confirmation submitted.");
      onDone();
    },
    onError: (e) => toast.error(e.message, { duration: 8000 }),
  });

  const cyclePpe = (key: string) => {
    setPpe((p) => {
      const cur = p[key];
      const idx = PPE_STATES.indexOf(cur);
      return { ...p, [key]: PPE_STATES[(idx + 1) % PPE_STATES.length] };
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-card w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold">Start-of-day confirmation</div>
            <div className="text-[10px] text-muted-foreground">
              FTS-APP-SOD V1 · takes under 2 minutes
            </div>
          </div>
          <button onClick={onClose} className="p-2">
            <X className="size-5" />
          </button>
        </div>

        <div>
          <div className="text-xs font-bold uppercase text-muted-foreground mb-1.5">
            Work readiness
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {FITNESS_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setFitness(o.key)}
                className={cn(
                  "h-11 rounded-lg border px-3 text-sm font-medium text-left",
                  fitness === o.key
                    ? o.key === "fit"
                      ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                      : "border-amber-400 bg-amber-50 text-amber-900"
                    : "border-border bg-background",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-bold uppercase text-muted-foreground mb-1.5">
            PPE — tap an item to change its state
          </div>
          <div className="space-y-1.5">
            {PPE_ITEMS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => cyclePpe(p.key)}
                className={cn(
                  "w-full flex items-center justify-between h-10 rounded-lg border px-3 text-[13px] font-medium",
                  PPE_STATE_CLS[ppe[p.key]],
                )}
              >
                <span className="truncate">{p.label}</span>
                <span className="text-[11px] font-bold shrink-0 ml-2">
                  {PPE_STATE_LABEL[ppe[p.key]]}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-bold uppercase text-muted-foreground mb-1.5">
            Daily communication
          </div>
          <div className="space-y-1">
            {COMMS_ITEMS.map((c) => (
              <label
                key={c.key}
                className="flex items-center gap-2.5 h-10 px-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="size-5"
                  checked={comms[c.key]}
                  onChange={(e) =>
                    setComms({ ...comms, [c.key]: e.target.checked })
                  }
                />
                {c.label}
              </label>
            ))}
            <label className="flex items-center gap-2.5 h-10 px-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="size-5"
                checked={toolbox}
                onChange={(e) => setToolbox(e.target.checked)}
              />
              Toolbox talk required today
            </label>
          </div>
        </div>

        <Button
          className="w-full h-12 text-base"
          disabled={submit.isPending}
          onClick={() =>
            submit.mutate({
              formNumber: "FTS-APP-SOD",
              clientUuid: uuid,
              answers: { fitness, ppe, comms, toolbox },
            })
          }
        >
          Submit confirmation
        </Button>
        {fitness !== "fit" && (
          <p className="text-[11px] text-amber-700">
            Your supervisor will follow up — no medical details are collected.
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------- Vehicle pre-use inspection ------------------- */

function VehicleInspectionDialog({
  truckName,
  onClose,
  onDone,
}: {
  truckName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [resp, setResp] = useState<Record<string, Resp>>({});
  const [defects, setDefects] = useState<Record<string, DefectDraft>>({});
  const [editingDefect, setEditingDefect] = useState<string | null>(null);
  const [uuid] = useState(() => crypto.randomUUID());

  const submit = trpc.safety.submitForm.useMutation({
    onSuccess: (r) => {
      const critical = Object.values(defects).some(
        (d) => d.severity === "critical",
      );
      if (critical)
        toast.error(
          "CRITICAL defect recorded — DO NOT OPERATE. Supervisor notified.",
          { duration: 10000 },
        );
      else
        toast.success(
          r.defectRefs.length
            ? `Inspection submitted — ${r.defectRefs.length} defect(s) logged.`
            : "Inspection submitted — all clear.",
        );
      onDone();
    },
    onError: (e) => toast.error(e.message, { duration: 8000 }),
  });

  const setItem = (sectionKey: string, itemKey: string, itemLabel: string, v: Resp) => {
    const k = `${sectionKey}.${itemKey}`;
    setResp((r) => ({ ...r, [k]: v }));
    if (v === "defect") {
      setDefects((d) => ({
        ...d,
        [k]: d[k] ?? {
          category: sectionKey,
          itemKey,
          itemLabel,
          severity: "minor",
          description: "",
          taggedOut: false,
        },
      }));
      setEditingDefect(k);
    } else {
      setDefects((d) => {
        const { [k]: _drop, ...rest } = d;
        return rest;
      });
      if (editingDefect === `${sectionKey}.${itemKey}`) setEditingDefect(null);
    }
  };

  const allPassSection = (sectionKey: string) => {
    const section = VEHICLE_INSPECTION_SECTIONS.find((s) => s.key === sectionKey)!;
    setResp((r) => {
      const next = { ...r };
      for (const it of section.items) {
        const k = `${sectionKey}.${it.key}`;
        if (!next[k] || next[k] === "not_inspected") next[k] = "pass";
      }
      return next;
    });
  };

  const missingRequired = VEHICLE_INSPECTION_SECTIONS.flatMap((s) =>
    s.items
      .filter((i) => i.required)
      .filter((i) => {
        const v = resp[`${s.key}.${i.key}`];
        return !v || v === "not_inspected";
      })
      .map((i) => i.label),
  );
  const defectList = Object.values(defects);
  const incompleteDefects = defectList.filter((d) => !d.description.trim());

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-card w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold">Vehicle pre-use inspection</div>
            <div className="text-[10px] text-muted-foreground">
              FTS-APP-VEH V1 · {truckName}
            </div>
          </div>
          <button onClick={onClose} className="p-2">
            <X className="size-5" />
          </button>
        </div>

        {VEHICLE_INSPECTION_SECTIONS.map((section) => (
          <div key={section.key}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-xs font-bold uppercase text-muted-foreground">
                {section.title}
              </div>
              <button
                type="button"
                onClick={() => allPassSection(section.key)}
                className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1"
              >
                All pass
              </button>
            </div>
            <div className="space-y-1.5">
              {section.items.map((item) => {
                const k = `${section.key}.${item.key}`;
                const v = resp[k] ?? "not_inspected";
                const draft = defects[k];
                return (
                  <div key={item.key}>
                    <div className="flex items-center gap-1.5">
                      <span className="flex-1 text-[13px] truncate">
                        {item.label}
                        {item.required && (
                          <span className="text-rose-500"> *</span>
                        )}
                      </span>
                      {(["pass", "defect", "na"] as Resp[]).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setItem(section.key, item.key, item.label, opt)}
                          className={cn(
                            "h-9 min-w-14 rounded-lg border px-2 text-[12px] font-bold",
                            v === opt
                              ? opt === "pass"
                                ? "border-emerald-400 bg-emerald-100 text-emerald-800"
                                : opt === "defect"
                                  ? "border-rose-400 bg-rose-100 text-rose-800"
                                  : "border-border bg-muted text-muted-foreground"
                              : "border-border bg-background text-muted-foreground",
                          )}
                        >
                          {opt === "pass" ? "Pass" : opt === "defect" ? "Defect" : "N/A"}
                        </button>
                      ))}
                    </div>
                    {draft && editingDefect === k && (
                      <div className="mt-1.5 rounded-lg border border-rose-200 bg-rose-50/60 p-2.5 space-y-2">
                        <div className="flex gap-1.5">
                          {(["minor", "major", "critical"] as const).map((sv) => (
                            <button
                              key={sv}
                              type="button"
                              onClick={() =>
                                setDefects((d) => ({ ...d, [k]: { ...d[k], severity: sv } }))
                              }
                              className={cn(
                                "flex-1 h-10 rounded-lg border text-[12px] font-bold uppercase",
                                draft.severity === sv
                                  ? sv === "critical"
                                    ? "border-rose-500 bg-rose-500 text-white"
                                    : sv === "major"
                                      ? "border-amber-500 bg-amber-400 text-white"
                                      : "border-yellow-400 bg-yellow-200 text-yellow-900"
                                  : "border-border bg-background text-muted-foreground",
                              )}
                            >
                              {sv}
                            </button>
                          ))}
                        </div>
                        {draft.severity === "critical" && (
                          <div className="text-[11px] font-bold text-rose-700">
                            🚫 Critical = DO NOT OPERATE. The vehicle cannot be
                            released and your supervisor is notified.
                          </div>
                        )}
                        <Textarea
                          value={draft.description}
                          onChange={(e) =>
                            setDefects((d) => ({
                              ...d,
                              [k]: { ...d[k], description: e.target.value },
                            }))
                          }
                          placeholder="What's wrong? (required)"
                          rows={2}
                        />
                        <label className="flex items-center gap-2 text-[12px]">
                          <input
                            type="checkbox"
                            className="size-4"
                            checked={draft.taggedOut}
                            onChange={(e) =>
                              setDefects((d) => ({
                                ...d,
                                [k]: { ...d[k], taggedOut: e.target.checked },
                              }))
                            }
                          />
                          Equipment tagged out
                        </label>
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={() => setEditingDefect(null)}
                        >
                          Done with this defect
                        </Button>
                      </div>
                    )}
                    {draft && editingDefect !== k && (
                      <button
                        type="button"
                        onClick={() => setEditingDefect(k)}
                        className="mt-1 w-full text-left text-[11px] text-rose-700 px-1"
                      >
                        ✎ {draft.severity.toUpperCase()}: {draft.description || "add description…"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {missingRequired.length > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
            {missingRequired.length} required item
            {missingRequired.length === 1 ? "" : "s"} not inspected yet —
            "not inspected" cannot satisfy a required item.
          </div>
        )}

        <Button
          className="w-full h-12 text-base"
          disabled={
            submit.isPending ||
            missingRequired.length > 0 ||
            incompleteDefects.length > 0
          }
          onClick={() =>
            submit.mutate({
              formNumber: "FTS-APP-VEH",
              unitName: truckName,
              clientUuid: uuid,
              answers: resp,
              defects: defectList.map((d) => ({
                category: d.category,
                itemKey: d.itemKey,
                severity: d.severity,
                description: d.description.trim(),
                taggedOut: d.taggedOut,
                supervisorNotified: d.severity === "critical",
              })),
            })
          }
        >
          Submit inspection
          {defectList.length > 0 ? ` (${defectList.length} defect${defectList.length === 1 ? "" : "s"})` : ""}
        </Button>
        {incompleteDefects.length > 0 && (
          <p className="text-[11px] text-rose-700">
            Every defect needs a description before submitting.
          </p>
        )}
      </div>
    </div>
  );
}
