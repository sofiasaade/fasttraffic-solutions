import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, ShieldCheck, LogOut, RefreshCw, Landmark, FileWarning,
  Receipt, TrendingUp, Lock,
} from "lucide-react";

const money = (c: number) =>
  (c / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });

const IDLE_LOGOUT_MS = 30 * 60 * 1000; // inactivity sign-out

type Step = "login" | "totp-setup" | "change-password" | "ready";

/**
 * ATLAS — Executive Command Center. Server-side the entire module is gated by
 * the "executive" role: this page merely renders; every query re-validates.
 */
export default function Atlas() {
  const utils = trpc.useUtils();
  const meQ = trpc.atlas.me.useQuery(undefined, { retry: false });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => window.location.reload(),
  });

  // ---------- idle timeout ----------
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!meQ.data) return;
    const reset = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        toast.info("Sesión cerrada por inactividad");
        logout.mutate();
      }, IDLE_LOGOUT_MS);
    };
    const events = ["mousemove", "keydown", "click", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!meQ.data]);

  if (meQ.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#10162e]">
        <Loader2 className="size-6 animate-spin text-white/60" />
      </div>
    );
  }
  if (meQ.error) return <AtlasLogin onDone={() => meQ.refetch()} />;
  return <AtlasShell email={meQ.data!.email ?? ""} onLogout={() => logout.mutate()} />;
}

/* ============================== LOGIN ============================== */

function AtlasLogin({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>("login");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [mustChange, setMustChange] = useState(false);

  const doLogin = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/exec-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, totp }),
      }).then((r) => r.json());
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo iniciar sesión");
        return;
      }
      setMustChange(!!r.mustChangePassword);
      if (!r.totpEnabled) {
        const s = await fetch("/api/exec-totp-setup", { method: "POST" }).then((r) => r.json());
        if (s.ok) {
          setTotpUri(s.uri);
          setTotpSecret(s.secret);
          setStep("totp-setup");
          return;
        }
      }
      if (r.mustChangePassword) {
        setStep("change-password");
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const confirmTotp = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/exec-totp-confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: confirmCode }),
      }).then((r) => r.json());
      if (!r.ok) return void toast.error(r.error ?? "Código incorrecto");
      toast.success("MFA activado ✔");
      if (mustChange) setStep("change-password");
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/exec-change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ current: password, next: newPass }),
      }).then((r) => r.json());
      if (!r.ok) return void toast.error(r.error ?? "No se pudo cambiar");
      toast.success("Contraseña actualizada ✔");
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#10162e] p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-[#1e2b58]">
            <ShieldCheck className="size-6 text-[#e8542f]" />
          </div>
          <div className="text-xl font-extrabold text-[#1e2b58]">ATLAS</div>
          <div className="text-xs text-slate-500">Executive Command Center · acceso exclusivo</div>
        </div>

        {step === "login" && (
          <div className="space-y-2.5">
            <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input placeholder="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Input placeholder="Código MFA (6 dígitos, si ya lo activaste)" inputMode="numeric" value={totp} onChange={(e) => setTotp(e.target.value)} />
            <Button className="w-full bg-[#1e2b58] hover:bg-[#2a3a72]" disabled={busy || !email || !password} onClick={doLogin}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4 mr-1" />} Entrar
            </Button>
          </div>
        )}

        {step === "totp-setup" && (
          <div className="space-y-3 text-sm">
            <p className="font-semibold text-[#1e2b58]">Activa tu MFA (una sola vez)</p>
            <ol className="list-decimal pl-4 space-y-1 text-slate-600 text-[13px]">
              <li>Abre Google Authenticator o 1Password en tu teléfono.</li>
              <li>Agrega una cuenta con esta clave manual:</li>
            </ol>
            <div className="rounded-lg bg-slate-100 p-2 text-center font-mono text-xs break-all select-all">{totpSecret}</div>
            {totpUri && (
              <a href={totpUri} className="block text-center text-xs text-[#e8542f] underline">
                o toca aquí desde el teléfono para agregarla automática
              </a>
            )}
            <Input placeholder="Código de 6 dígitos que muestra la app" inputMode="numeric" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} />
            <Button className="w-full bg-[#1e2b58]" disabled={busy || confirmCode.length < 6} onClick={confirmTotp}>
              Confirmar y activar MFA
            </Button>
          </div>
        )}

        {step === "change-password" && (
          <div className="space-y-2.5">
            <p className="text-sm font-semibold text-[#1e2b58]">Crea tu contraseña definitiva</p>
            <Input placeholder="Nueva contraseña (mín. 10 caracteres)" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
            <Button className="w-full bg-[#1e2b58]" disabled={busy || newPass.length < 10} onClick={changePassword}>
              Guardar y entrar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== SHELL ============================== */

const TABS = [
  "Snapshot", "CEO", "CFO", "Collections", "Unbilled", "CMO", "My Priorities", "Decisions",
] as const;

function AtlasShell({ email, onLogout }: { email: string; onLogout: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Snapshot");
  const snapQ = trpc.atlas.snapshot.useQuery(undefined, { refetchInterval: 5 * 60_000 });
  const s = snapQ.data;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-[#10162e] text-white">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 font-extrabold tracking-tight">
            <ShieldCheck className="size-5 text-[#e8542f]" /> ATLAS
            <span className="text-white/40 font-normal text-xs hidden sm:inline">Executive Command Center</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-white/70">
            <span className="hidden sm:inline">{email}</span>
            <button onClick={() => snapQ.refetch()} title="Actualizar" className="p-1.5 rounded hover:bg-white/10">
              <RefreshCw className={cn("size-4", snapQ.isFetching && "animate-spin")} />
            </button>
            <button onClick={onLogout} title="Salir" className="p-1.5 rounded hover:bg-white/10">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-2 text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors",
                tab === t ? "border-[#e8542f] text-white" : "border-transparent text-white/60 hover:text-white",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5 space-y-4">
        {/* Source freshness strip — every figure names its source */}
        {s && (
          <div className="flex flex-wrap gap-2 text-[11px]">
            {Object.values(s.sources).map((src: any) => (
              <span
                key={src.label}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium",
                  src.ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800",
                )}
              >
                <span className={cn("size-1.5 rounded-full", src.ok ? "bg-emerald-500" : "bg-amber-500")} />
                {src.label}
              </span>
            ))}
            <span className="text-slate-400 self-center">
              Snapshot: {new Date(s.generatedAt).toLocaleString()}
            </span>
          </div>
        )}

        {tab === "Snapshot" && (
          snapQ.isLoading ? (
            <div className="py-20 flex justify-center"><Loader2 className="size-6 animate-spin text-slate-400" /></div>
          ) : s ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi icon={Receipt} label="Facturado este mes" value={money(s.billing.invoicedThisMonthCents)}
                  sub={`${s.billing.invoicedThisMonthCount} facturas · mes anterior ${money(s.billing.invoicedPrevMonthCents)}`}
                  source="FTS OS invoices" />
                <Kpi icon={Landmark} label="Pendiente por cobrar (app)" value={money(s.billing.outstandingAppCents)}
                  sub={`${s.billing.outstandingAppCount} facturas sent / in QB — el saldo contable llega con QuickBooks`}
                  source="FTS OS invoices" warn={s.billing.outstandingAppCents > 0} />
                <Kpi icon={FileWarning} label="Completado SIN facturar" value={String(s.unbilled.withoutInvoice)}
                  sub={`${s.unbilled.over48h} llevan más de 48 h — meta: facturar en 24-48 h`}
                  source="Airtable + FTS OS" warn={s.unbilled.over48h > 0} />
                <Kpi icon={TrendingUp} label="Pipeline de cotizaciones" value={money(s.billing.quotesPipelineCents)}
                  sub={`${s.billing.quotesCount} quotes guardadas (FTS-Q)`} source="FTS OS quotes" />
              </div>

              {/* Unbilled worklist — the money on the table */}
              <UnbilledTable jobs={s.unbilled.jobs} over48h={s.unbilled.over48h} />
            </>
          ) : null
        )}

        {tab === "Collections" && <CollectionsTab />}
        {tab === "My Priorities" && <PrioritiesTab />}
        {tab === "Decisions" && <DecisionsTab />}
        {tab === "Unbilled" && (
          s ? (
            <UnbilledTable jobs={s.unbilled.jobs} over48h={s.unbilled.over48h} />
          ) : (
            <div className="py-20 flex justify-center"><Loader2 className="size-6 animate-spin text-slate-400" /></div>
          )
        )}
        {(tab === "CEO" || tab === "CFO" || tab === "CMO") && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            <p className="font-semibold text-slate-600 mb-1">{tab}</p>
            {tab === "CFO"
              ? "Se completa al conectar QuickBooks (F1d) — nada se muestra sin datos reales."
              : "En construcción — próxima fase del plan aprobado."}
          </div>
        )}
      </main>
    </div>
  );
}

/* ============================ UNBILLED ============================ */

function UnbilledTable({ jobs, over48h }: { jobs: any[]; over48h: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
        Trabajos completados sin factura ({jobs.length}) — los más viejos primero
        {over48h > 0 && <span className="ml-2 text-amber-300">· {over48h} con más de 48 h</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b">
              <th className="text-left px-4 py-2">Cliente</th>
              <th className="text-left px-2">Status</th>
              <th className="text-right px-2">Terminó</th>
              <th className="text-right px-4">Días sin facturar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.map((j: any) => (
              <tr key={j.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-medium">{j.company ?? j.id}</td>
                <td className="px-2 text-slate-500">{j.status}</td>
                <td className="px-2 text-right tabular-nums text-slate-500">{j.endDate ?? "—"}</td>
                <td className={cn("px-4 text-right tabular-nums font-bold",
                  (j.ageDays ?? 0) >= 2 ? "text-red-600" : "text-slate-700")}>
                  {j.ageDays ?? "?"}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                Nada pendiente — todo lo completado está facturado ✔
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ========================= F1c — COLLECTIONS ========================= */

const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
const BUCKET_LABEL: Record<string, string> = {
  current: "Al día", "1-30": "1-30 días", "31-60": "31-60 días",
  "61-90": "61-90 días", "90+": "Más de 90",
};
const RISK_STYLE: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-700",
  med: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

function CollectionsTab() {
  const utils = trpc.useUtils();
  const q = trpc.atlas.collectionsList.useQuery();
  const update = trpc.atlas.collectionsUpdate.useMutation({
    onSuccess: () => {
      utils.atlas.collectionsList.invalidate();
      toast.success("Seguimiento guardado");
    },
    onError: (e) => toast.error(e.message),
  });
  const [openId, setOpenId] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  if (q.isLoading)
    return <div className="py-20 flex justify-center"><Loader2 className="size-6 animate-spin text-slate-400" /></div>;
  const data = q.data;
  if (!data) return null;

  const openRow = (r: any) => {
    setOpenId(r.invoiceId === openId ? null : r.invoiceId);
    setForm({
      lastContact: r.followUp?.lastContact ?? "",
      contactOutcome: r.followUp?.contactOutcome ?? "",
      nextFollowUp: r.followUp?.nextFollowUp ?? "",
      responsible: r.followUp?.responsible ?? "",
      promiseToPay: r.followUp?.promiseToPay ?? false,
      promiseDate: r.followUp?.promiseDate ?? "",
      dispute: r.followUp?.dispute ?? false,
      disputeNote: r.followUp?.disputeNote ?? "",
      riskLevel: r.followUp?.riskLevel ?? "low",
      notes: r.followUp?.notes ?? "",
    });
  };
  const save = (invoiceId: number) =>
    update.mutate({
      invoiceId,
      lastContact: form.lastContact || null,
      contactOutcome: form.contactOutcome || null,
      nextFollowUp: form.nextFollowUp || null,
      responsible: form.responsible || null,
      promiseToPay: !!form.promiseToPay,
      promiseDate: form.promiseToPay ? form.promiseDate || null : null,
      dispute: !!form.dispute,
      disputeNote: form.dispute ? form.disputeNote || null : null,
      riskLevel: form.riskLevel,
      notes: form.notes || null,
    });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });

  return (
    <div className="space-y-4">
      {/* Aging buckets */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {BUCKETS.map((b) => {
          const t = data.totals[b];
          return (
            <div key={b} className={cn(
              "rounded-xl border bg-white p-3",
              b === "90+" && t ? "border-red-300" : b === "61-90" && t ? "border-amber-300" : "border-slate-200",
            )}>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{BUCKET_LABEL[b]}</div>
              <div className="text-lg font-extrabold tabular-nums text-[#1e2b58]">{money(t?.cents ?? 0)}</div>
              <div className="text-[11px] text-slate-500">{t?.count ?? 0} facturas</div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500">{data.note}</p>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
          Por cobrar ({data.rows.length}) · {money(data.outstandingCents)} — las más vencidas primero
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b">
                <th className="text-left px-4 py-2">Factura</th>
                <th className="text-left px-2">Cliente</th>
                <th className="text-right px-2">Total</th>
                <th className="text-right px-2">Días</th>
                <th className="text-left px-2">Riesgo</th>
                <th className="text-left px-2">Seguimiento</th>
                <th className="px-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((r: any) => (
                <Fragment key={r.invoiceId}>
                  <tr className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs">
                      {r.invoiceNumber}
                      {r.qbNumber && <span className="text-slate-400"> · QB {r.qbNumber}</span>}
                    </td>
                    <td className="px-2 font-medium">{r.clientName}</td>
                    <td className="px-2 text-right tabular-nums font-semibold">{money(r.totalCents)}</td>
                    <td className={cn("px-2 text-right tabular-nums font-bold",
                      r.ageDays > 60 ? "text-red-600" : r.ageDays > 30 ? "text-amber-600" : "text-slate-600")}>
                      {r.ageDays}
                      <span className="block text-[9px] font-normal text-slate-400">
                        {r.agingBasis === "due" ? "desde vencimiento" : "desde emisión"}
                      </span>
                    </td>
                    <td className="px-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                        RISK_STYLE[r.followUp?.riskLevel ?? "low"])}>
                        {r.followUp?.riskLevel ?? "low"}
                      </span>
                    </td>
                    <td className="px-2 text-[11px] text-slate-600 max-w-[220px]">
                      {r.followUp?.promiseToPay && (
                        <span className="text-emerald-700 font-semibold">Promesa {r.followUp.promiseDate ?? ""} · </span>
                      )}
                      {r.followUp?.dispute && <span className="text-red-600 font-semibold">Disputa · </span>}
                      {r.followUp?.nextFollowUp ? (
                        <span className={cn(r.followUp.nextFollowUp <= today && "text-amber-700 font-semibold")}>
                          Próx: {r.followUp.nextFollowUp}
                        </span>
                      ) : (
                        !r.followUp && <span className="text-slate-400">Sin gestión aún</span>
                      )}
                    </td>
                    <td className="px-2 text-right">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openRow(r)}>
                        {openId === r.invoiceId ? "Cerrar" : "Gestionar"}
                      </Button>
                    </td>
                  </tr>
                  {openId === r.invoiceId && (
                    <tr className="bg-slate-50">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="grid gap-2.5 md:grid-cols-3">
                          <label className="text-xs space-y-1">
                            <span className="font-semibold text-slate-600">Último contacto</span>
                            <Input type="date" value={form.lastContact} onChange={(e) => set("lastContact", e.target.value)} className="h-8 bg-white" />
                          </label>
                          <label className="text-xs space-y-1 md:col-span-2">
                            <span className="font-semibold text-slate-600">Resultado del contacto</span>
                            <Input value={form.contactOutcome} placeholder="Ej: hablé con AP, dicen que pagan el viernes" onChange={(e) => set("contactOutcome", e.target.value)} className="h-8 bg-white" />
                          </label>
                          <label className="text-xs space-y-1">
                            <span className="font-semibold text-slate-600">Próximo seguimiento</span>
                            <Input type="date" value={form.nextFollowUp} onChange={(e) => set("nextFollowUp", e.target.value)} className="h-8 bg-white" />
                          </label>
                          <label className="text-xs space-y-1">
                            <span className="font-semibold text-slate-600">Responsable</span>
                            <Input value={form.responsible} placeholder="Sofia / esposo / bookkeeper" onChange={(e) => set("responsible", e.target.value)} className="h-8 bg-white" />
                          </label>
                          <label className="text-xs space-y-1">
                            <span className="font-semibold text-slate-600">Riesgo</span>
                            <select value={form.riskLevel} onChange={(e) => set("riskLevel", e.target.value)}
                              className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs">
                              <option value="low">Bajo</option>
                              <option value="med">Medio</option>
                              <option value="high">Alto</option>
                            </select>
                          </label>
                          <div className="text-xs space-y-1.5">
                            <label className="flex items-center gap-2 font-semibold text-slate-600">
                              <input type="checkbox" checked={form.promiseToPay} onChange={(e) => set("promiseToPay", e.target.checked)} />
                              Promesa de pago
                            </label>
                            {form.promiseToPay && (
                              <Input type="date" value={form.promiseDate} onChange={(e) => set("promiseDate", e.target.value)} className="h-8 bg-white" />
                            )}
                          </div>
                          <div className="text-xs space-y-1.5 md:col-span-2">
                            <label className="flex items-center gap-2 font-semibold text-slate-600">
                              <input type="checkbox" checked={form.dispute} onChange={(e) => set("dispute", e.target.checked)} />
                              En disputa
                            </label>
                            {form.dispute && (
                              <Input value={form.disputeNote} placeholder="¿Qué disputa el cliente?" onChange={(e) => set("disputeNote", e.target.value)} className="h-8 bg-white" />
                            )}
                          </div>
                          <label className="text-xs space-y-1 md:col-span-3">
                            <span className="font-semibold text-slate-600">Notas</span>
                            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2}
                              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs" />
                          </label>
                        </div>
                        <div className="mt-2 flex justify-end">
                          <Button size="sm" className="bg-[#1e2b58]" disabled={update.isPending} onClick={() => save(r.invoiceId)}>
                            {update.isPending && <Loader2 className="size-3.5 animate-spin mr-1" />} Guardar seguimiento
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {data.rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No hay facturas pendientes por cobrar ✔
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ==================== F1e — MY EXECUTIVE PRIORITIES ==================== */

const PRIO_CATEGORIES = ["CEO", "CFO", "CMO", "Operaciones", "Ventas", "Personal", "Tecnología", "Seguridad"];
const STATUS_LABEL: Record<string, string> = {
  not_started: "No iniciada",
  in_progress: "En progreso",
  waiting: "En espera",
  delegated: "Delegada",
  decision_required: "Requiere decisión",
  completed: "Completada",
  cancelled: "Cancelada",
};
const PRIO_DOT: Record<string, string> = {
  high: "bg-red-500", med: "bg-amber-500", low: "bg-slate-400",
};
type PrioView = "today" | "week" | "overdue" | "waiting" | "delegated" | "all" | "done";
const PRIO_VIEWS: { key: PrioView; label: string }[] = [
  { key: "today", label: "Hoy" },
  { key: "week", label: "Esta semana" },
  { key: "overdue", label: "Vencidas" },
  { key: "waiting", label: "En espera" },
  { key: "delegated", label: "Delegadas" },
  { key: "all", label: "Todas activas" },
  { key: "done", label: "Completadas" },
];

function PrioritiesTab() {
  const utils = trpc.useUtils();
  const q = trpc.atlas.prioritiesList.useQuery();
  const invalidate = () => utils.atlas.prioritiesList.invalidate();
  const create = trpc.atlas.priorityCreate.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const update = trpc.atlas.priorityUpdate.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const del = trpc.atlas.priorityDelete.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });

  const [view, setView] = useState<PrioView>("all");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("CEO");
  const [prio, setPrio] = useState<"low" | "med" | "high">("med");
  const [due, setDue] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
  const weekEnd = (() => {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  const rows = q.data ?? [];
  const active = rows.filter((r) => r.status !== "completed" && r.status !== "cancelled");
  const filtered = (() => {
    switch (view) {
      case "today": return active.filter((r) => r.dueDate && r.dueDate <= today);
      case "week": return active.filter((r) => r.dueDate && r.dueDate <= weekEnd);
      case "overdue": return active.filter((r) => r.dueDate && r.dueDate < today);
      case "waiting": return active.filter((r) => r.status === "waiting");
      case "delegated": return active.filter((r) => r.status === "delegated");
      case "done": return rows.filter((r) => r.status === "completed" || r.status === "cancelled");
      default: return active;
    }
  })();
  const sorted = [...filtered].sort((a, b) => {
    const rank: Record<string, number> = { high: 0, med: 1, low: 2 };
    return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || rank[a.priority] - rank[b.priority];
  });

  const add = () => {
    if (!title.trim()) return;
    create.mutate({ title: title.trim(), category, priority: prio, dueDate: due || null, recurrence: "none" });
    setTitle(""); setDue("");
  };

  return (
    <div className="space-y-4">
      {/* Quick add */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap gap-2 items-center">
        <Input value={title} placeholder="Nueva prioridad… (Enter para agregar)" className="h-9 flex-1 min-w-[220px]"
          onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-md border border-slate-200 px-2 text-sm">
          {PRIO_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={prio} onChange={(e) => setPrio(e.target.value as any)}
          className="h-9 rounded-md border border-slate-200 px-2 text-sm">
          <option value="high">Alta</option>
          <option value="med">Media</option>
          <option value="low">Baja</option>
        </select>
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-9 w-[150px]" />
        <Button className="h-9 bg-[#1e2b58]" disabled={!title.trim() || create.isPending} onClick={add}>Agregar</Button>
      </div>

      {/* Views */}
      <div className="flex flex-wrap gap-1.5">
        {PRIO_VIEWS.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={cn("rounded-full px-3 py-1 text-xs font-semibold border",
              view === v.key ? "bg-[#1e2b58] text-white border-[#1e2b58]" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400")}>
            {v.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        {sorted.map((r) => (
          <div key={r.id}>
            <div className="px-3 py-2.5 flex items-center gap-2.5">
              <span className={cn("size-2.5 rounded-full shrink-0", PRIO_DOT[r.priority])} title={r.priority} />
              <button className="flex-1 text-left" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                <span className={cn("text-sm font-medium",
                  (r.status === "completed" || r.status === "cancelled") && "line-through text-slate-400")}>
                  {r.title}
                </span>
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{r.category}</span>
                {r.dueDate && (
                  <span className={cn("ml-2 text-[11px] tabular-nums",
                    r.dueDate < today && r.status !== "completed" ? "text-red-600 font-bold" : "text-slate-400")}>
                    {r.dueDate}
                  </span>
                )}
                {r.status === "delegated" && r.delegatedTo && (
                  <span className="ml-2 text-[11px] text-indigo-600">→ {r.delegatedTo}</span>
                )}
                {r.status === "waiting" && r.waitingOn && (
                  <span className="ml-2 text-[11px] text-amber-600">espera a {r.waitingOn}</span>
                )}
              </button>
              <select value={r.status}
                onChange={(e) => update.mutate({ id: r.id, status: e.target.value as any })}
                className="h-7 rounded-md border border-slate-200 px-1.5 text-[11px] text-slate-600">
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button className="p-1 text-slate-300 hover:text-red-500" title="Eliminar"
                onClick={() => { if (confirm("¿Eliminar esta prioridad?")) del.mutate({ id: r.id }); }}>
                ✕
              </button>
            </div>
            {openId === r.id && (
              <PriorityDetail row={r} onSave={(patch) => update.mutate({ id: r.id, ...patch })} saving={update.isPending} />
            )}
          </div>
        ))}
        {sorted.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-slate-400">
            {view === "done" ? "Nada completado todavía." : "Sin prioridades en esta vista — agrega una arriba."}
          </div>
        )}
      </div>
    </div>
  );
}

function PriorityDetail({ row, onSave, saving }: { row: any; onSave: (p: any) => void; saving: boolean }) {
  const [nextAction, setNextAction] = useState(row.nextAction ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const [delegatedTo, setDelegatedTo] = useState(row.delegatedTo ?? "");
  const [waitingOn, setWaitingOn] = useState(row.waitingOn ?? "");
  const [dueDate, setDueDate] = useState(row.dueDate ?? "");
  return (
    <div className="px-4 pb-3 bg-slate-50 border-t border-slate-100">
      <div className="grid gap-2.5 md:grid-cols-2 pt-3">
        <label className="text-xs space-y-1">
          <span className="font-semibold text-slate-600">Siguiente acción</span>
          <Input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="h-8 bg-white" />
        </label>
        <label className="text-xs space-y-1">
          <span className="font-semibold text-slate-600">Fecha límite</span>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-8 bg-white" />
        </label>
        <label className="text-xs space-y-1">
          <span className="font-semibold text-slate-600">Delegada a</span>
          <Input value={delegatedTo} onChange={(e) => setDelegatedTo(e.target.value)} className="h-8 bg-white" />
        </label>
        <label className="text-xs space-y-1">
          <span className="font-semibold text-slate-600">Esperando a</span>
          <Input value={waitingOn} onChange={(e) => setWaitingOn(e.target.value)} className="h-8 bg-white" />
        </label>
        <label className="text-xs space-y-1 md:col-span-2">
          <span className="font-semibold text-slate-600">Notas</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs" />
        </label>
      </div>
      <div className="mt-2 flex justify-end">
        <Button size="sm" className="bg-[#1e2b58]" disabled={saving}
          onClick={() => onSave({
            nextAction: nextAction || null,
            notes: notes || null,
            delegatedTo: delegatedTo || null,
            waitingOn: waitingOn || null,
            dueDate: dueDate || null,
          })}>
          Guardar detalles
        </Button>
      </div>
    </div>
  );
}

/* ======================= F1e — DECISION INBOX ======================= */

function DecisionsTab() {
  const utils = trpc.useUtils();
  const q = trpc.atlas.decisionsList.useQuery();
  const invalidate = () => utils.atlas.decisionsList.invalidate();
  const create = trpc.atlas.decisionCreate.useMutation({
    onSuccess: () => { invalidate(); toast.success("Decisión agregada al inbox"); },
    onError: (e) => toast.error(e.message),
  });
  const decide = trpc.atlas.decisionDecide.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const del = trpc.atlas.decisionDelete.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });

  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState({ title: "", context: "", optionsText: "", recommendation: "", dueDate: "", ownerAfter: "" });
  const [noteById, setNoteById] = useState<Record<number, string>>({});

  const rows = q.data ?? [];
  const open = rows.filter((r) => r.status === "open");
  const decided = rows.filter((r) => r.status !== "open");
  const parseOptions = (r: any): { label: string; impact?: string }[] => {
    try { return r.optionsJson ? JSON.parse(r.optionsJson) : []; } catch { return []; }
  };

  const submit = () => {
    if (!f.title.trim()) return;
    const options = f.optionsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [label, impact] = l.split("|").map((s) => s.trim());
        return { label, ...(impact ? { impact } : {}) };
      });
    create.mutate({
      title: f.title.trim(),
      context: f.context || null,
      options: options.length ? options : undefined,
      recommendation: f.recommendation || null,
      dueDate: f.dueDate || null,
      ownerAfter: f.ownerAfter || null,
    });
    setF({ title: "", context: "", optionsText: "", recommendation: "", dueDate: "", ownerAfter: "" });
    setShowForm(false);
  };

  const setD = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          <span className="font-bold text-[#1e2b58]">{open.length}</span> decisiones esperando tu criterio.
          ATLAS solo registra lo que decidas — nunca ejecuta nada solo.
        </p>
        <Button size="sm" className="bg-[#1e2b58]" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancelar" : "+ Nueva decisión"}
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
          <Input value={f.title} placeholder="¿Qué hay que decidir?" onChange={(e) => setD("title", e.target.value)} />
          <textarea value={f.context} placeholder="Contexto — qué pasó, cifras, por qué importa"
            onChange={(e) => setD("context", e.target.value)} rows={2}
            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
          <textarea value={f.optionsText} placeholder={"Opciones, una por línea. Formato: opción | impacto\nEj: Subir tarifa a $95 | +$18k/año, riesgo de perder 1-2 clientes chicos"}
            onChange={(e) => setD("optionsText", e.target.value)} rows={3}
            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm font-mono" />
          <Input value={f.recommendation} placeholder="Recomendación (opcional)" onChange={(e) => setD("recommendation", e.target.value)} />
          <div className="flex gap-2">
            <label className="text-xs flex-1 space-y-1">
              <span className="font-semibold text-slate-600">Fecha límite</span>
              <Input type="date" value={f.dueDate} onChange={(e) => setD("dueDate", e.target.value)} className="h-8" />
            </label>
            <label className="text-xs flex-1 space-y-1">
              <span className="font-semibold text-slate-600">Responsable después de decidir</span>
              <Input value={f.ownerAfter} placeholder="¿Quién lo ejecuta?" onChange={(e) => setD("ownerAfter", e.target.value)} className="h-8" />
            </label>
          </div>
          <div className="flex justify-end">
            <Button size="sm" className="bg-[#1e2b58]" disabled={!f.title.trim() || create.isPending} onClick={submit}>
              Guardar en el inbox
            </Button>
          </div>
        </div>
      )}

      {q.isLoading && <div className="py-16 flex justify-center"><Loader2 className="size-6 animate-spin text-slate-400" /></div>}

      {open.map((r) => {
        const opts = parseOptions(r);
        return (
          <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-bold text-[#1e2b58]">{r.title}</div>
                {r.dueDate && <div className="text-[11px] text-slate-500">Decidir antes de: <b>{r.dueDate}</b></div>}
              </div>
              <button className="text-slate-300 hover:text-red-500 text-sm" title="Eliminar"
                onClick={() => { if (confirm("¿Eliminar esta decisión?")) del.mutate({ id: r.id }); }}>✕</button>
            </div>
            {r.context && <p className="text-sm text-slate-600 whitespace-pre-wrap">{r.context}</p>}
            {opts.length > 0 && (
              <ul className="space-y-1">
                {opts.map((o, i) => (
                  <li key={i} className="text-sm rounded-lg bg-slate-50 px-3 py-1.5">
                    <span className="font-semibold">{String.fromCharCode(65 + i)}. {o.label}</span>
                    {o.impact && <span className="text-slate-500"> — {o.impact}</span>}
                  </li>
                ))}
              </ul>
            )}
            {r.recommendation && (
              <p className="text-sm rounded-lg bg-[#fdece5] px-3 py-1.5 text-[#8a3418]">
                <b>Recomendación:</b> {r.recommendation}
              </p>
            )}
            {r.ownerAfter && <p className="text-[11px] text-slate-500">Al decidir, lo ejecuta: <b>{r.ownerAfter}</b></p>}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input value={noteById[r.id] ?? ""} placeholder="Nota de la decisión (opcional)"
                onChange={(e) => setNoteById((m) => ({ ...m, [r.id]: e.target.value }))} className="h-8 flex-1 min-w-[180px] text-xs" />
              <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => decide.mutate({ id: r.id, status: "approved", decisionNote: noteById[r.id] || null })}>Aprobar</Button>
              <Button size="sm" variant="destructive" className="h-8"
                onClick={() => decide.mutate({ id: r.id, status: "rejected", decisionNote: noteById[r.id] || null })}>Rechazar</Button>
              <Button size="sm" variant="outline" className="h-8"
                onClick={() => decide.mutate({ id: r.id, status: "postponed", decisionNote: noteById[r.id] || null })}>Posponer</Button>
            </div>
          </div>
        );
      })}
      {!q.isLoading && open.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
          Inbox vacío — no hay decisiones pendientes.
        </div>
      )}

      {decided.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-2 bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Historial de decisiones
          </div>
          <div className="divide-y divide-slate-100">
            {decided.map((r) => (
              <div key={r.id} className="px-4 py-2 text-sm flex items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                  r.status === "approved" ? "bg-emerald-100 text-emerald-700"
                    : r.status === "rejected" ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700")}>
                  {r.status === "approved" ? "Aprobada" : r.status === "rejected" ? "Rechazada" : "Pospuesta"}
                </span>
                <span className="font-medium flex-1">{r.title}</span>
                {r.decisionNote && <span className="text-slate-500 text-xs truncate max-w-[280px]">{r.decisionNote}</span>}
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {r.decidedAt ? new Date(r.decidedAt).toLocaleDateString("en-CA") : ""}
                </span>
                <Button size="sm" variant="ghost" className="h-6 text-[11px] text-slate-400"
                  onClick={() => decide.mutate({ id: r.id, status: "open" })}>Reabrir</Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, source, warn }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; sub: string; source: string; warn?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border bg-white p-3.5", warn ? "border-amber-300" : "border-slate-200")}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-[#1e2b58]">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500 leading-snug">{sub}</div>
      <div className="mt-1 text-[10px] text-slate-400">Fuente: {source}</div>
    </div>
  );
}
