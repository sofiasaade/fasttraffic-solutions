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
  const me: any = meQ.data!;
  // The server refuses every data call until setup is complete, so this screen
  // is not skippable by reloading — it's the only path to the numbers.
  if (me.needsPasswordChange || me.needsMfa) {
    return <AtlasSetup needsPassword={me.needsPasswordChange} needsMfa={me.needsMfa} onDone={() => meQ.refetch()} />;
  }
  return <AtlasShell email={me.email ?? ""} onLogout={() => logout.mutate()} />;
}

/* ======================= FORCED ACCOUNT SETUP ======================= */

function AtlasSetup({ needsPassword, needsMfa, onDone }: {
  needsPassword: boolean; needsMfa: boolean; onDone: () => void;
}) {
  const [passDone, setPassDone] = useState(!needsPassword);
  const [mfaDone, setMfaDone] = useState(!needsMfa);
  const [current, setCurrent] = useState("");
  const [newPass, setNewPass] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!needsMfa) return;
    fetch("/api/exec-totp-setup", { method: "POST" })
      .then((r) => r.json())
      .then((s) => { if (s.ok) { setSecret(s.secret); setUri(s.uri); } });
  }, [needsMfa]);

  useEffect(() => {
    if (passDone && mfaDone) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passDone, mfaDone]);

  const changePass = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/exec-change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ current, next: newPass }),
      }).then((r) => r.json());
      if (!r.ok) return void toast.error(r.error ?? "No se pudo cambiar la contraseña");
      toast.success("Contraseña definitiva guardada ✔");
      setPassDone(true);
    } finally { setBusy(false); }
  };

  const confirmMfa = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/exec-totp-confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }).then((r) => r.json());
      if (!r.ok) return void toast.error(r.error ?? "El código no coincidió — usa el más reciente de la app");
      toast.success("MFA activado ✔");
      setMfaDone(true);
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#10162e] p-4 flex items-center justify-center">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center text-white">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-white/10">
            <ShieldCheck className="size-6 text-[#e8542f]" />
          </div>
          <div className="text-xl font-extrabold">Asegura tu cuenta</div>
          <p className="text-xs text-white/60 mt-1">
            ATLAS muestra tus bancos y tu cartera — el servidor no entrega ningún dato
            hasta completar estos {needsPassword && needsMfa ? "2 pasos" : "pasos"} (una sola vez).
          </p>
        </div>

        {needsPassword && (
          <div className={cn("rounded-2xl bg-white p-5 space-y-2.5", passDone && "opacity-60")}>
            <div className="font-bold text-[#1e2b58] text-sm">
              {passDone ? "✔ Contraseña definitiva creada" : "1 · Crea tu contraseña definitiva"}
            </div>
            {!passDone && (
              <>
                <Input placeholder="Contraseña actual (la temporal)" type="password" value={current}
                  onChange={(e) => setCurrent(e.target.value)} />
                <Input placeholder="Nueva contraseña (mín. 10 caracteres)" type="password" value={newPass}
                  onChange={(e) => setNewPass(e.target.value)} />
                <Button className="w-full bg-[#1e2b58]" disabled={busy || newPass.length < 10 || !current} onClick={changePass}>
                  Guardar contraseña
                </Button>
              </>
            )}
          </div>
        )}

        {needsMfa && (
          <div className={cn("rounded-2xl bg-white p-5 space-y-2.5", mfaDone && "opacity-60")}>
            <div className="font-bold text-[#1e2b58] text-sm">
              {mfaDone ? "✔ MFA activado" : `${needsPassword ? "2" : "1"} · Activa el código de seguridad (MFA)`}
            </div>
            {!mfaDone && (
              <>
                <ol className="list-decimal pl-4 space-y-1 text-[13px] text-slate-600">
                  <li>En tu teléfono abre <b>Google Authenticator</b> (gratis en App Store / Play Store).</li>
                  <li>Toca <b>+</b> → "Introducir clave de configuración" → cuenta: <b>FTS ATLAS</b> → pega esta clave:</li>
                </ol>
                <div className="rounded-lg bg-slate-100 p-2 text-center font-mono text-xs break-all select-all">
                  {secret ?? "…"}
                </div>
                {uri && (
                  <a href={uri} className="block text-center text-xs text-[#e8542f] underline">
                    (si estás en el teléfono, toca aquí y se agrega sola)
                  </a>
                )}
                <Input placeholder="Código de 6 dígitos (usa uno recién generado)" inputMode="numeric" value={code}
                  onChange={(e) => setCode(e.target.value)} />
                <Button className="w-full bg-[#1e2b58]" disabled={busy || code.replace(/\s/g, "").length < 6} onClick={confirmMfa}>
                  Confirmar y activar
                </Button>
                <p className="text-[11px] text-slate-400">
                  El código cambia cada 30 s — escribe el que esté en pantalla y confirma de una vez.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
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
        {tab === "CFO" && <CfoTab onNavigate={(t) => setTab(t as any)} />}
        {tab === "CEO" && <CeoTab />}
        {tab === "CMO" && <CmoTab />}
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
                <td className="px-2 text-right tabular-nums text-slate-500">{j.endDate ? String(j.endDate).slice(0, 10) : "—"}</td>
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

/* =========================== F2 — CEO =========================== */

function CeoTab() {
  const q = trpc.atlas.ceo.useQuery(undefined, { refetchInterval: 10 * 60_000 });
  const utils = trpc.useUtils();
  const [printing, setPrinting] = useState(false);

  const printWeekly = async () => {
    setPrinting(true);
    try {
      const [ceo, cfo, coll, prios] = await Promise.all([
        utils.client.atlas.ceo.query(),
        utils.client.atlas.cfo.query(),
        utils.client.atlas.collectionsList.query(),
        utils.client.atlas.prioritiesList.query(),
      ]);
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
      const m = (cents: number | null | undefined) =>
        cents == null ? "—" : (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
      const cf: any = cfo;
      const openPrios = prios.filter((p: any) => p.status !== "completed" && p.status !== "cancelled");
      const overduePrios = openPrios.filter((p: any) => p.dueDate && p.dueDate < today);
      const promises = coll.rows.filter((r: any) => r.followUp?.promiseToPay);
      const disputes = coll.rows.filter((r: any) => r.followUp?.dispute);
      const months = ((ceo as any).months ?? []).filter((x: any) => x.incomeCents != null);
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Reporte semanal FTS — ${today}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1e2b58;margin:0;padding:32px 40px;font-size:13px}
  .brand{font-weight:800;font-size:20px}.brand span{color:#e8542f}
  h1{font-size:20px;margin:4px 0 2px}.sub{color:#6b7280;font-size:12px;margin-bottom:18px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#e8542f;border-bottom:2px solid #fdece5;padding-bottom:3px;margin:20px 0 8px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;color:#94a3b8;font-size:10px;text-transform:uppercase;padding:3px 6px;border-bottom:1px solid #e2e8f0}
  td{padding:4px 6px;border-bottom:1px solid #f1f5f9}.r{text-align:right;font-variant-numeric:tabular-nums}
  ul{margin:4px 0;padding-left:18px}li{margin:3px 0}
  .kpis{display:flex;gap:14px;flex-wrap:wrap;margin:6px 0}
  .kpi{border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;min-width:150px}
  .kpi b{display:block;font-size:16px}.kpi span{font-size:10px;color:#6b7280;text-transform:uppercase}
  .foot{margin-top:24px;color:#94a3b8;font-size:10px}
  @media print{body{padding:16px 20px}}
</style></head><body>
<div class="brand">FAST<span>»</span>TRAFFIC</div>
<h1>Reporte semanal ejecutivo</h1>
<div class="sub">${today} · generado por ATLAS · fuentes: QuickBooks (solo lectura), FTS OS, Airtable</div>
<h2>Resumen</h2>
<ul>${((ceo as any).summary ?? []).map((s: string) => `<li>${s}</li>`).join("")}</ul>
<h2>Cifras clave</h2>
<div class="kpis">
  <div class="kpi"><span>Efectivo en bancos (QB)</span><b>${m(cf?.cash?.totalCents)}</b></div>
  <div class="kpi"><span>Por cobrar contable (QB)</span><b>${m(cf?.ar?.totalCents)}</b></div>
  <div class="kpi"><span>Vencido +60 días (QB)</span><b>${m(cf?.ar ? (cf.ar.buckets["61-90"] ?? 0) + (cf.ar.buckets["90+"] ?? 0) : null)}</b></div>
  <div class="kpi"><span>Facturado este mes (app)</span><b>${m((ceo as any).ops.invoicedThisMonthCents)}</b></div>
  <div class="kpi"><span>Trabajos sin facturar</span><b>${(ceo as any).ops.unbilledJobs ?? "—"}</b></div>
</div>
<h2>Tendencia mensual (P&L QuickBooks)</h2>
<table><tr><th>Mes</th><th class="r">Ingresos</th><th class="r">Gastos</th><th class="r">Neto</th></tr>
${months.map((x: any) => `<tr><td>${x.title}</td><td class="r">${m(x.incomeCents)}</td><td class="r">${m(x.expensesCents)}</td><td class="r">${m(x.netCents)}</td></tr>`).join("")}
</table>
<h2>Cobranza</h2>
<ul>
  <li>${coll.rows.length} facturas por cobrar en la app por ${m(coll.outstandingCents)}.</li>
  <li>${promises.length} con promesa de pago · ${disputes.length} en disputa.</li>
  ${cf?.ar?.topCustomers?.length ? `<li>Quien más debe (QB): ${cf.ar.topCustomers.slice(0, 3).map((t: any) => `${t.name} (${m(t.cents)})`).join(" · ")}</li>` : ""}
</ul>
<h2>Mis prioridades</h2>
<ul>
  <li>${openPrios.length} prioridades activas · ${overduePrios.length} vencidas.</li>
  ${overduePrios.slice(0, 5).map((p: any) => `<li>VENCIDA: ${p.title} (${p.dueDate})</li>`).join("")}
</ul>
<div class="foot">Confidencial — uso exclusivo de la dirección de Fast Traffic Solutions Ltd. Cifras tomadas en vivo al momento de generar; nada es estimado.</div>
<script>window.print()</script>
</body></html>`;
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
    } catch (e: any) {
      toast.error("No se pudo generar el reporte: " + (e?.message ?? ""));
    } finally { setPrinting(false); }
  };

  if (q.isLoading)
    return <div className="py-20 flex justify-center"><Loader2 className="size-6 animate-spin text-slate-400" /></div>;
  const c: any = q.data;
  if (!c) return null;
  const months = (c.months ?? []).filter((m: any) => m.incomeCents != null);
  const maxIncome = Math.max(1, ...months.map((m: any) => m.incomeCents));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={printWeekly} disabled={printing}>
          {printing && <Loader2 className="size-3.5 animate-spin mr-1" />} 🖨 Reporte semanal
        </Button>
      </div>
      {/* Written summary */}
      {c.summary?.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Resumen ejecutivo</div>
          <ul className="space-y-1.5">
            {c.summary.map((s: string, i: number) => (
              <li key={i} className="text-sm text-slate-700 flex gap-2">
                <span className="text-[#e8542f] font-bold">›</span>{s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Monthly trend — real QB P&L */}
      {months.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-3">
            Ingresos vs gastos por mes — P&L de QuickBooks
          </div>
          <div className="flex items-end gap-3 h-44">
            {months.map((m: any) => (
              <div key={m.title} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div className="text-[10px] tabular-nums font-bold text-[#1e2b58]">
                  {money(m.incomeCents).replace(".00", "")}
                </div>
                <div className="w-full flex items-end gap-0.5 flex-1">
                  <div className="flex-1 bg-[#1e2b58] rounded-t"
                    style={{ height: `${(m.incomeCents / maxIncome) * 100}%` }} title={`Ingresos ${money(m.incomeCents)}`} />
                  <div className="flex-1 bg-[#e8542f]/70 rounded-t"
                    style={{ height: `${(m.expensesCents / maxIncome) * 100}%` }} title={`Gastos ${money(m.expensesCents)}`} />
                </div>
                <div className="text-[10px] text-slate-500 truncate w-full text-center">{m.title}</div>
                <div className={cn("text-[10px] tabular-nums font-semibold",
                  m.netCents >= 0 ? "text-emerald-600" : "text-red-600")}>
                  {m.netCents >= 0 ? "+" : ""}{Math.round(m.netCents / 100).toLocaleString("en-CA")}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-4 text-[10px] text-slate-500">
            <span><span className="inline-block size-2 bg-[#1e2b58] rounded-sm mr-1" />Ingresos</span>
            <span><span className="inline-block size-2 bg-[#e8542f]/70 rounded-sm mr-1" />Gastos</span>
            <span>Neto debajo de cada mes</span>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          {c.qbConnected ? "Sin datos del P&L todavía." : "La tendencia mensual llega de QuickBooks — conéctalo en CFO."}
        </div>
      )}

      {/* Jobs: this year vs last year */}
      {c.jobsYoY?.rows?.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">
            Trabajos por mes — este año vs el año pasado
          </div>
          <p className="text-[12px] text-slate-500 mb-3">
            Cuántos trabajos INICIARON cada mes (Airtable, excluye cancelados). La barra gris es el mismo mes del año anterior.
          </p>
          <div className="flex items-end gap-3 h-36">
            {c.jobsYoY.rows.map((r: any) => {
              const max = Math.max(1, ...c.jobsYoY.rows.flatMap((x: any) => [x.jobs, x.jobsPrevYear ?? 0]));
              const delta = r.jobsPrevYear ? Math.round(((r.jobs - r.jobsPrevYear) / r.jobsPrevYear) * 100) : null;
              return (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <div className="text-[10px] tabular-nums font-bold text-[#1e2b58]">
                    {r.jobs}{r.jobsPrevYear != null && <span className="text-slate-400 font-normal"> / {r.jobsPrevYear}</span>}
                  </div>
                  <div className="w-full flex items-end gap-0.5 flex-1">
                    <div className="flex-1 bg-[#1e2b58] rounded-t" style={{ height: `${(r.jobs / max) * 100}%`, minHeight: 3 }}
                      title={`${r.month}: ${r.jobs} trabajos${r.partial ? " (mes en curso)" : ""}`} />
                    <div className="flex-1 bg-slate-300 rounded-t" style={{ height: `${((r.jobsPrevYear ?? 0) / max) * 100}%`, minHeight: r.jobsPrevYear != null ? 3 : 0 }}
                      title={r.jobsPrevYear != null ? `mismo mes ${Number(r.month.slice(0, 4)) - 1}: ${r.jobsPrevYear} trabajos` : "sin dato del año anterior"} />
                  </div>
                  <div className="text-[10px] text-slate-500 truncate w-full text-center">
                    {r.month.slice(5)}/{r.month.slice(2, 4)}{r.partial && "*"}
                  </div>
                  {delta != null && !r.partial && (
                    <div className={cn("text-[10px] font-semibold tabular-nums", delta >= 0 ? "text-emerald-600" : "text-red-600")}>
                      {delta >= 0 ? "+" : ""}{delta}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-4 text-[10px] text-slate-500">
            <span><span className="inline-block size-2 bg-[#1e2b58] rounded-sm mr-1" />Este año</span>
            <span><span className="inline-block size-2 bg-slate-300 rounded-sm mr-1" />Año pasado</span>
            <span>* mes en curso (día {c.jobsYoY.dayOfMonth}) — se compara contra el mes COMPLETO anterior</span>
          </div>
        </div>
      )}

      <EarnedIncome />

      {/* Ops pulse */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Receipt} label="Facturado este mes (app)" value={money(c.ops.invoicedThisMonthCents)}
          sub={`${c.ops.invoicedThisMonthCount} facturas`} source="FTS OS" />
        <Kpi icon={FileWarning} label="Sin facturar" value={c.ops.unbilledJobs != null ? String(c.ops.unbilledJobs) : "—"}
          sub="trabajos completados sin factura" source="Airtable + FTS OS" warn={(c.ops.unbilledJobs ?? 0) > 0} />
        <Kpi icon={TrendingUp} label="Pipeline quotes" value={money(c.ops.quotesCents)}
          sub={`${c.ops.quotesCount} cotizaciones`} source="FTS OS" />
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Rentabilidad por trabajo</div>
          <div className="mt-1 text-sm font-semibold text-slate-500">No disponible</div>
          <div className="mt-0.5 text-[11px] text-slate-500 leading-snug">{c.profitability?.reason}</div>
        </div>
      </div>

      {c.errors?.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-[12px] text-amber-800">
          <ul className="list-disc pl-4">{c.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/* ============== INGRESO POR MES DE TRABAJO (devengado) ============== */

function EarnedIncome() {
  const q = trpc.atlas.earnedIncome.useQuery(undefined, { refetchInterval: 10 * 60_000 });
  if (q.isLoading)
    return <div className="py-6 flex justify-center"><Loader2 className="size-5 animate-spin text-slate-400" /></div>;
  const c: any = q.data;
  if (!c?.connected || !c.months?.length) return null;

  const monthName = (key: string) => {
    const [y, m] = key.split("-");
    const names = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    return `${names[Number(m) - 1]} ${y}`;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
        Neto por mes de TRABAJO — el ingreso se cuenta cuando se hizo el proyecto, no cuando se facturó
      </div>
      <div className="px-4 py-2 text-[12px] text-slate-600 bg-slate-50 border-b">
        {Math.round(c.coverage * 100)}% del ingreso pudo atribuirse a su mes real de trabajo
        (fecha de servicio en la factura, o fecha de fin del proyecto en Airtable).
        El resto se muestra aparte como «mes de factura».
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b">
              <th className="text-left px-4 py-1.5">Mes</th>
              <th className="text-right px-2">Trabajo realizado</th>
              <th className="text-right px-2">Sin fecha (mes de factura)</th>
              <th className="text-right px-2">Gastos</th>
              <th className="text-right px-4">Neto del mes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {c.months.map((m: any) => (
              <tr key={m.month}>
                <td className="px-4 py-1.5 font-medium text-slate-700">{monthName(m.month)}</td>
                <td className="px-2 text-right tabular-nums font-semibold text-[#1e2b58]">
                  {m.earnedCents ? money(m.earnedCents) : "—"}
                </td>
                <td className="px-2 text-right tabular-nums text-slate-500">
                  {m.unattributedCents ? money(m.unattributedCents) : "—"}
                </td>
                <td className="px-2 text-right tabular-nums text-slate-500">
                  {m.expensesCents != null ? money(m.expensesCents) : "—"}
                </td>
                <td className={cn("px-4 text-right tabular-nums font-bold",
                  m.netCents == null ? "text-slate-400" : m.netCents >= 0 ? "text-emerald-700" : "text-red-600")}>
                  {m.netCents != null ? money(m.netCents) : "sin gastos QB"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px] text-slate-400">
        Fuente: facturas de QuickBooks reasignadas a su mes de trabajo + gastos del P&L mensual de QuickBooks.
        {c.window?.capped && " Historial limitado a las últimas 1000 facturas."}
      </p>
      {c.errors?.length > 0 && (
        <div className="mx-4 mb-3 rounded-lg bg-amber-50 border border-amber-200 p-2 text-[12px] text-amber-800">
          <ul className="list-disc pl-4">{c.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/* =========================== F2 — CMO =========================== */

function CmoTab() {
  const q = trpc.atlas.cmo.useQuery(undefined, { refetchInterval: 10 * 60_000 });
  if (q.isLoading)
    return <div className="py-20 flex justify-center"><Loader2 className="size-6 animate-spin text-slate-400" /></div>;
  const c: any = q.data;
  if (!c) return null;
  if (!c.connected)
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        El análisis de clientes sale del historial de facturas de QuickBooks — conéctalo en la pestaña CFO.
      </div>
    );
  const y = c.year;
  return (
    <div className="space-y-4">
      {y && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Kpi icon={Receipt} label={`Facturado ${y.from.slice(0, 4)}`} value={money(y.totalCents)}
              sub={`${y.customers} clientes facturados este año`} source="QuickBooks" />
            <Kpi icon={TrendingUp} label="Concentración top 3" value={`${Math.round(y.top3Share * 100)}%`}
              sub={y.top3Share > 0.6 ? "Alta dependencia de pocos clientes — riesgo a vigilar" : "Cartera razonablemente diversificada"}
              source="QuickBooks" warn={y.top3Share > 0.6} />
            <Kpi icon={Landmark} label="Clientes nuevos (6 meses)"
              value={String((c.newByMonth ?? []).reduce((n: number, m: any) => n + m.newCustomers, 0))}
              sub="primera factura en ese periodo" source="QuickBooks" />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
              De dónde viene el ingreso {y.from.slice(0, 4)} — top 10 clientes
            </div>
            <div className="divide-y divide-slate-100">
              {y.top.map((t: any, i: number) => (
                <div key={t.name} className="px-4 py-2 flex items-center gap-3 text-sm">
                  <span className="w-5 text-right text-slate-400 tabular-nums">{i + 1}</span>
                  <span className="flex-1 font-medium truncate">{t.name}</span>
                  <div className="w-32 h-2 rounded bg-slate-100 overflow-hidden hidden sm:block">
                    <div className="h-full bg-[#e8542f]" style={{ width: `${Math.max(2, t.share * 100)}%` }} />
                  </div>
                  <span className="w-12 text-right text-[11px] text-slate-500 tabular-nums">{Math.round(t.share * 100)}%</span>
                  <span className="w-24 text-right font-semibold tabular-nums">{money(t.cents)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Clientes nuevos por mes</div>
            <div className="flex items-end gap-2 h-20">
              {(c.newByMonth ?? []).map((m: any) => {
                const max = Math.max(1, ...c.newByMonth.map((x: any) => x.newCustomers));
                return (
                  <div key={m.title} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-bold text-[#1e2b58] tabular-nums">{m.newCustomers}</span>
                    <div className="w-full bg-[#1e2b58]/80 rounded-t" style={{ height: `${(m.newCustomers / max) * 56}px` }} />
                    <span className="text-[9px] text-slate-500">{m.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      {c.window && (
        <p className="text-[11px] text-slate-400">
          Fuente: {c.window.count} facturas de QuickBooks ({c.window.from} → {c.window.to}).
        </p>
      )}
      {c.errors?.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-[12px] text-amber-800">
          <ul className="list-disc pl-4">{c.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/* ====================== F2 — 13-WEEK CASH VIEW ====================== */

function CashFlow13() {
  const q = trpc.atlas.cashflow13.useQuery(undefined, { refetchInterval: 10 * 60_000 });
  const c: any = q.data;
  if (q.isLoading)
    return <div className="py-8 flex justify-center"><Loader2 className="size-5 animate-spin text-slate-400" /></div>;
  if (!c?.connected || !c.weeks) return null;

  let running = c.cashCents ?? 0;
  const rows = c.weeks.map((w: any, i: number) => {
    const outflow = c.avgWeeklyExpenseCents ?? 0;
    running = running + w.inflowCents - outflow;
    return { ...w, idx: i + 1, outflow, running };
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
        Caja a 13 semanas — entradas por vencimientos reales, gastos = promedio real de las últimas 12 semanas
      </div>
      <div className="px-4 py-2 text-[12px] text-slate-600 border-b bg-slate-50 flex flex-wrap gap-x-5 gap-y-1">
        <span>Caja hoy: <b className="tabular-nums">{money(c.cashCents ?? 0)}</b></span>
        {c.overdueCents > 0 && (
          <span className="text-red-700">Ya vencido por cobrar: <b className="tabular-nums">{money(c.overdueCents)}</b> (no se cuenta en ninguna semana — hay que gestionarlo)</span>
        )}
        <span>Gasto semanal de referencia: <b className="tabular-nums">{c.avgWeeklyExpenseCents != null ? money(c.avgWeeklyExpenseCents) : "no disponible"}</b></span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b">
              <th className="text-left px-4 py-1.5">Semana</th>
              <th className="text-right px-2">Cobros por vencer</th>
              <th className="text-right px-2">Gastos (ref.)</th>
              <th className="text-right px-4">Caja proyectada</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r: any) => (
              <tr key={r.idx} className={cn(r.running < 0 && "bg-red-50")}>
                <td className="px-4 py-1.5 text-slate-600">S{r.idx} · {r.start}</td>
                <td className="px-2 text-right tabular-nums text-emerald-700">{r.inflowCents ? money(r.inflowCents) : "—"}</td>
                <td className="px-2 text-right tabular-nums text-slate-500">{r.outflow ? money(r.outflow) : "—"}</td>
                <td className={cn("px-4 text-right tabular-nums font-semibold", r.running < 0 ? "text-red-600" : "text-slate-800")}>
                  {money(r.running)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px] text-slate-400">
        Los cobros usan las fechas de vencimiento reales de QuickBooks (si un cliente paga tarde, se mueve).
        El gasto es tu promedio real reciente, como referencia — no una predicción.
      </p>
    </div>
  );
}

/* ==================== F1d — CFO (QuickBooks read-only) ==================== */

function CfoTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const statusQ = trpc.atlas.qbStatus.useQuery();
  const [period, setPeriod] = useState<"month" | "last_month" | "quarter" | "ytd" | "12m">("month");
  const [seriesMonths, setSeriesMonths] = useState<3 | 6 | 12 | 24>(12);
  const ovQ = trpc.atlas.cfoOverview.useQuery(
    { period, seriesMonths },
    { enabled: !!statusQ.data?.connected, refetchInterval: 10 * 60_000 },
  );
  const cfQ = trpc.atlas.cashflow13.useQuery(undefined, { enabled: !!statusQ.data?.connected });
  const utils = trpc.useUtils();
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    const qb = new URLSearchParams(window.location.search).get("qb");
    if (!qb) return;
    if (qb === "connected") toast.success("QuickBooks conectado ✔ (solo lectura)");
    else if (qb === "denied") toast.info("Conexión cancelada en Intuit.");
    else toast.error("No se pudo conectar QuickBooks — intenta de nuevo.");
    window.history.replaceState(null, "", "/atlas");
  }, []);

  const disconnect = async () => {
    if (!confirm("¿Desconectar QuickBooks? Se revoca el acceso en Intuit.")) return;
    const r = await fetch("/api/qb/disconnect", { method: "POST" }).then((r) => r.json());
    if (r.ok) {
      toast.success("QuickBooks desconectado");
      utils.atlas.qbStatus.invalidate();
      utils.atlas.snapshot.invalidate();
    }
  };

  if (statusQ.isLoading)
    return <div className="py-20 flex justify-center"><Loader2 className="size-6 animate-spin text-slate-400" /></div>;
  const st = statusQ.data;
  if (!st) return null;

  if (!st.connected) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 max-w-xl mx-auto text-center space-y-4">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#2CA01C]/10">
          <Landmark className="size-7 text-[#2CA01C]" />
        </div>
        <div>
          <p className="font-bold text-[#1e2b58] text-lg">Conectar QuickBooks</p>
          <p className="text-sm text-slate-500 mt-1">
            Acceso <b>solo lectura</b> por OAuth oficial de Intuit — inicias sesión en la página de
            Intuit, nunca escribes tu contraseña de QuickBooks aquí. ATLAS jamás crea ni edita nada
            en QuickBooks.
          </p>
        </div>
        {st.configured ? (
          <Button className="bg-[#2CA01C] hover:bg-[#238015] text-white"
            onClick={() => { window.location.href = "/api/qb/connect"; }}>
            Conectar con Intuit
          </Button>
        ) : (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-[13px] text-amber-800 text-left">
            Falta configurar las llaves de la app de Intuit (QB_CLIENT_ID y QB_CLIENT_SECRET en Railway).
          </div>
        )}
      </div>
    );
  }

  const o: any = ovQ.data;
  const PERIODS: { key: typeof period; label: string }[] = [
    { key: "month", label: "Este mes" },
    { key: "last_month", label: "Mes pasado" },
    { key: "quarter", label: "Trimestre" },
    { key: "ytd", label: "Año (YTD)" },
    { key: "12m", label: "12 meses" },
  ];
  const updatedAt = o ? new Date(o.generatedAt).toLocaleTimeString() : "";

  return (
    <div className="space-y-4">
      {/* connection + global filter */}
      <div className="flex flex-wrap items-center gap-2 justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm">
        <span className="text-emerald-800">
          <b>QuickBooks conectado</b>{st.companyName ? <> — {st.companyName}</> : null} · solo lectura
          {o && <span className="text-emerald-700/70"> · sincronizado {updatedAt}</span>}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => ovQ.refetch()} className="text-xs text-emerald-700 underline">Actualizar</button>
          <button onClick={disconnect} className="text-xs text-emerald-700 underline">Desconectar</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {PERIODS.map((pp) => (
          <button key={pp.key} onClick={() => setPeriod(pp.key)}
            className={cn("rounded-full px-3 py-1 text-xs font-semibold border",
              period === pp.key ? "bg-[#1e2b58] text-white border-[#1e2b58]" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400")}>
            {pp.label}
          </button>
        ))}
        <button onClick={() => { setPeriod("month"); setSeriesMonths(12); }}
          className="text-[11px] text-slate-400 underline ml-1">Restablecer filtros</button>
      </div>

      {ovQ.isLoading && <div className="py-16 flex justify-center"><Loader2 className="size-6 animate-spin text-slate-400" /></div>}

      {o?.connected && (
        <>
          {/* ============ 1. SALUD FINANCIERA DE UN VISTAZO ============ */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi2 label="Efectivo disponible" cents={o.cash?.totalCents ?? null}
              tip="Suma de los saldos actuales de tus cuentas bancarias en QuickBooks."
              source="QuickBooks · bancos" updated={updatedAt}
              onClick={() => setShowMore(true)} />
            <Kpi2 label="Facturado (periodo)" cents={o.pnl?.cur?.incomeCents ?? null} prev={o.pnl?.prev?.incomeCents ?? null}
              tip="Ingresos del P&L de QuickBooks en el periodo elegido. Facturar no es cobrar."
              source="QuickBooks · P&L" updated={updatedAt} />
            <Kpi2 label="Cobrado en efectivo (periodo)" cents={o.collected?.curCents ?? null} prev={o.collected?.prevCents ?? null}
              tip="Pagos realmente recibidos de clientes en el periodo (registro de Payments en QuickBooks)."
              source="QuickBooks · pagos" updated={updatedAt} />
            <Kpi2 label="Por cobrar (neto)" cents={o.ar?.netCents ?? o.ar?.totalCents ?? null}
              tip={o.ar?.creditsCents != null
                ? `Facturas abiertas ${money(o.ar.totalCents)} menos créditos a favor de clientes y pagos sin aplicar ${money(o.ar.creditsCents)}. Es lo realmente cobrable.`
                : "Saldo abierto de todas las facturas sin pagar."}
              source="QuickBooks · facturas − créditos" updated={updatedAt}
              onClick={() => onNavigate("Collections")} />
            <Kpi2 label="Por cobrar VENCIDO" cents={o.ar?.overdueCents ?? null} warn
              tip="Parte de la cartera cuya fecha de vencimiento ya pasó."
              source="QuickBooks · facturas abiertas" updated={updatedAt}
              onClick={() => onNavigate("Collections")} />
            <Kpi2 label="Completado sin facturar" count={o.cbnb?.total ?? null} warn={(o.cbnb?.total ?? 0) > 0}
              tip="Trabajos terminados u recogidos en Airtable que no tienen factura en la app. El valor en dólares no es calculable todavía (no existe factura)."
              source="Airtable + FTS OS" updated={updatedAt}
              onClick={() => onNavigate("Unbilled")} />
            <Kpi2 label="Margen bruto" cents={null}
              unavailableText={o.pnl?.cur?.grossCents != null ? undefined : "No disponible — tu QuickBooks no registra costos de venta (COGS); no se calcula un margen falso."}
              centsOverride={o.pnl?.cur?.grossCents ?? null}
              pctOf={o.pnl?.cur?.grossCents != null ? o.pnl?.cur?.incomeCents : null}
              tip="Ingresos menos costos directos de los trabajos (COGS). Solo se muestra si QuickBooks tiene esos costos registrados."
              source="QuickBooks · P&L" updated={updatedAt} />
            <Kpi2 label="Resultado neto (periodo)" cents={o.pnl?.cur?.netCents ?? null} prev={o.pnl?.prev?.netCents ?? null}
              tip="Lo que queda después de todos los gastos del periodo, según el P&L de QuickBooks."
              source="QuickBooks · P&L" updated={updatedAt} />
          </div>

          {/* ============ 2. RESUMEN EJECUTIVO ============ */}
          {o.summary && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">¿Cómo está la empresa? — resumen en palabras simples</div>
              {o.summary.hechos?.length > 0 && (
                <ul className="space-y-1">{o.summary.hechos.map((t: string, i: number) => (
                  <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-slate-400 font-bold shrink-0">Hecho ·</span>{t}</li>))}
                </ul>
              )}
              {o.summary.alertas?.length > 0 && (
                <ul className="space-y-1">{o.summary.alertas.map((t: string, i: number) => (
                  <li key={i} className="text-sm text-amber-800 flex gap-2"><span className="text-amber-500 font-bold shrink-0">Alerta ·</span>{t}</li>))}
                </ul>
              )}
              {o.summary.acciones?.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mt-1">Revisa primero</div>
                  <ol className="list-decimal pl-5 space-y-0.5">{o.summary.acciones.map((t: string, i: number) => (
                    <li key={i} className="text-sm font-medium text-[#1e2b58]">{t}</li>))}
                  </ol>
                </div>
              )}
            </div>
          )}

          {/* ============ 3. GRÁFICAS PRINCIPALES ============ */}
          {o.series && (
            <RevCollectChart series={o.series} months={seriesMonths} onMonths={setSeriesMonths}
              capped={o.invoicesCapped || o.paymentsCapped} />
          )}
          {o.ar && <ArAgingBar ar={o.ar} onOpen={() => onNavigate("Collections")} />}
          {cfQ.data?.connected && o.cash && (
            <CashProjectionChart cf={cfQ.data} cashCents={o.cash.totalCents} />
          )}
          {o.cbnb && <CbnbBars cbnb={o.cbnb} onOpen={() => onNavigate("Unbilled")} />}

          {/* ============ 4. MÁS ANÁLISIS ============ */}
          <button onClick={() => setShowMore((v) => !v)}
            className="w-full rounded-xl border border-dashed border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">
            {showMore ? "▲ Ocultar análisis adicional" : "▼ Más análisis financiero (gastos por categoría, obligaciones, bancos, deudores)"}
          </button>
          {showMore && (
            <div className="space-y-4">
              <OpexCategories cur={o.pnl?.cur} prev={o.pnl?.prev} />
              {o.obligations && <Obligations ob={o.obligations} />}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Cuentas bancarias</div>
                  {o.cash?.accounts?.map((a: any) => (
                    <div key={a.name} className="text-sm flex justify-between py-0.5">
                      <span className="text-slate-600 truncate mr-2">{a.name}</span>
                      <span className="tabular-nums font-semibold">{money(a.balanceCents)}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Top 5 vencidas — llama primero aquí</div>
                  {o.ar?.topOverdue?.map((t: any) => (
                    <div key={t.doc} className="text-sm flex justify-between py-0.5 gap-2">
                      <span className="text-slate-600 truncate">{t.customer} <span className="text-slate-400 text-xs">#{t.doc} · {t.age} días</span></span>
                      <span className="tabular-nums font-semibold text-red-600">{money(t.cents)}</span>
                    </div>
                  ))}
                  {(o.ar?.topOverdue?.length ?? 0) === 0 && <p className="text-sm text-slate-400">Nada vencido ✔</p>}
                </div>
              </div>
            </div>
          )}

          {o.errors?.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-[12px] text-amber-800">
              Datos no disponibles ahora mismo (solo se muestran cifras reales):
              <ul className="list-disc pl-4">{o.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
          <p className="text-[10px] text-slate-400">
            Fuente contable: QuickBooks (solo lectura) · Fuente operativa: Airtable + FTS OS · Periodo: {o.range?.cur?.start} → {o.range?.cur?.end} · Actualizado {updatedAt}.
            {(o.invoicesCapped || o.paymentsCapped) && " Historial limitado a los últimos 1000 registros por consulta."}
          </p>
        </>
      )}
    </div>
  );
}

/* ---------- KPI card v2 ---------- */
function Kpi2({ label, cents, centsOverride, count, prev, pctOf, warn, tip, source, updated, onClick, unavailableText }: {
  label: string; cents?: number | null; centsOverride?: number | null; count?: number | null;
  prev?: number | null; pctOf?: number | null; warn?: boolean; tip: string; source: string;
  updated: string; onClick?: () => void; unavailableText?: string;
}) {
  const val = centsOverride ?? cents;
  const hasVal = val != null || count != null;
  const delta = val != null && prev != null && prev !== 0 ? ((val - prev) / Math.abs(prev)) * 100 : null;
  return (
    <div title={tip} onClick={onClick}
      className={cn("rounded-xl border bg-white p-3.5 text-left",
        warn && hasVal ? "border-amber-300" : "border-slate-200",
        onClick && "cursor-pointer hover:border-[#1e2b58]/50")}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      {hasVal ? (
        <>
          <div className={cn("mt-1 text-xl font-extrabold tabular-nums", warn ? "text-amber-700" : "text-[#1e2b58]")}>
            {val != null ? money(val) : String(count)}
            {pctOf != null && pctOf > 0 && val != null && (
              <span className="ml-1 text-sm font-bold text-slate-500">({Math.round((val / pctOf) * 100)}%)</span>
            )}
          </div>
          {delta != null && (
            <div className={cn("text-[11px] font-semibold tabular-nums", delta >= 0 ? "text-emerald-600" : "text-red-600")}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}% vs periodo anterior
            </div>
          )}
          {delta == null && prev != null && <div className="text-[11px] text-slate-400">anterior: {money(prev)}</div>}
        </>
      ) : (
        <div className="mt-1 text-sm font-semibold text-slate-400">{unavailableText ?? "No disponible"}</div>
      )}
      <div className="mt-1 text-[10px] text-slate-400">{source} · {updated}</div>
    </div>
  );
}

/* ---------- Gráfica 1: Facturado vs Cobrado ---------- */
function RevCollectChart({ series, months, onMonths, capped }: {
  series: any[]; months: 3 | 6 | 12 | 24; onMonths: (m: 3 | 6 | 12 | 24) => void; capped?: boolean;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const W = 720, H = 200, PAD = 8;
  const max = Math.max(1, ...series.map((s) => Math.max(s.invoicedCents, s.collectedCents)));
  const bw = (W - PAD * 2) / series.length;
  const y = (c: number) => H - (c / max) * (H - 24);
  const line = series.map((s, i) => `${i === 0 ? "M" : "L"}${PAD + bw * i + bw / 2},${y(s.collectedCents)}`).join(" ");
  const selRow = series.find((s) => s.month === sel);
  const mesCorto = (k: string) => k.slice(5) + "/" + k.slice(2, 4);
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider flex items-center justify-between gap-2 flex-wrap">
        <span>Facturado vs Cobrado por mes</span>
        <span className="flex gap-1">
          {([3, 6, 12, 24] as const).map((m) => (
            <button key={m} onClick={() => onMonths(m)}
              className={cn("rounded px-2 py-0.5 text-[11px]", months === m ? "bg-white text-[#1e2b58]" : "bg-white/10")}>{m}m</button>
          ))}
        </span>
      </div>
      <p className="px-4 pt-2 text-[12px] text-slate-500">
        Las barras son lo que facturaste cada mes; la línea naranja es el dinero que realmente entró. Si la línea va muy por debajo de las barras, estás financiando a tus clientes.
      </p>
      <div className="px-2 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full min-w-[480px]">
          {series.map((s, i) => (
            <g key={s.month} onClick={() => setSel(sel === s.month ? null : s.month)} className="cursor-pointer">
              <rect x={PAD + bw * i + bw * 0.15} y={y(s.invoicedCents)} width={bw * 0.7} height={H - y(s.invoicedCents)}
                fill={sel === s.month ? "#2a3a72" : "#1e2b58"} rx="2">
                <title>{`${s.month}: facturado ${money(s.invoicedCents)} (${s.invoicedCount} fact.) · cobrado ${money(s.collectedCents)} (${s.collectedCount} pagos)`}</title>
              </rect>
              <text x={PAD + bw * i + bw / 2} y={H + 12} textAnchor="middle" fontSize="9" fill="#94a3b8">{mesCorto(s.month)}</text>
            </g>
          ))}
          <path d={line} fill="none" stroke="#e8542f" strokeWidth="2.5" />
          {series.map((s, i) => (
            <circle key={s.month} cx={PAD + bw * i + bw / 2} cy={y(s.collectedCents)} r="3" fill="#e8542f">
              <title>{`${s.month}: cobrado ${money(s.collectedCents)}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      {selRow && (
        <div className="mx-4 mb-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[12px] text-slate-700">
          <b>{selRow.month}</b>: facturado {money(selRow.invoicedCents)} en {selRow.invoicedCount} facturas · cobrado {money(selRow.collectedCents)} en {selRow.collectedCount} pagos.
          Diferencia: <b className={selRow.invoicedCents - selRow.collectedCents > 0 ? "text-amber-700" : "text-emerald-700"}>{money(selRow.invoicedCents - selRow.collectedCents)}</b>
          {" "}· el detalle factura por factura está en QuickBooks.
        </div>
      )}
      <div className="px-4 pb-2 flex gap-4 text-[10px] text-slate-500">
        <span><span className="inline-block size-2 bg-[#1e2b58] rounded-sm mr-1" />Facturado (fecha de factura)</span>
        <span><span className="inline-block size-2 bg-[#e8542f] rounded-full mr-1" />Cobrado (fecha de pago)</span>
        <span className="text-slate-400">Fuente: QuickBooks{capped ? " · limitado a 1000 registros" : ""} · toca un mes para el detalle</span>
      </div>
    </div>
  );
}

/* ---------- Gráfica 2: Antigüedad de cartera ---------- */
const AGING_STYLES: Record<string, { bg: string; label: string }> = {
  current: { bg: "#94a3b8", label: "Al día" },
  "1-30": { bg: "#fbbf24", label: "1-30 días" },
  "31-60": { bg: "#f97316", label: "31-60 días" },
  "61-90": { bg: "#ef4444", label: "61-90 días" },
  "90+": { bg: "#b91c1c", label: "+90 días" },
};
function ArAgingBar({ ar, onOpen }: { ar: any; onOpen: () => void }) {
  const total = Math.max(1, ar.totalCents);
  const over60 = (ar.buckets["61-90"]?.cents ?? 0) + (ar.buckets["90+"]?.cents ?? 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
        ¿Qué tan vieja es la plata que te deben?
      </div>
      <p className="px-4 pt-2 text-[12px] text-slate-500">
        Todo lo que está por cobrar ({money(ar.totalCents)} en {ar.openInvoices} facturas), separado por cuánto tiempo lleva vencido. Toca cualquier franja para abrir Collections.
      </p>
      <div className="px-4 py-3">
        <div className="flex h-9 w-full overflow-hidden rounded-lg cursor-pointer" onClick={onOpen}>
          {Object.entries(AGING_STYLES).map(([k, st]) => {
            const b = ar.buckets[k] ?? { cents: 0, count: 0 };
            if (!b.cents) return null;
            return (
              <div key={k} style={{ width: `${Math.max(3, (b.cents / total) * 100)}%`, background: st.bg }}
                className="h-full" title={`${st.label}: ${money(b.cents)} (${b.count} facturas)`} />
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-1.5">
          {Object.entries(AGING_STYLES).map(([k, st]) => {
            const b = ar.buckets[k] ?? { cents: 0, count: 0 };
            return (
              <button key={k} onClick={onOpen} className="rounded-lg border border-slate-100 p-1.5 text-left hover:border-slate-300">
                <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                  <span className="size-2 rounded-sm" style={{ background: st.bg }} />{st.label}
                </div>
                <div className="text-sm font-extrabold tabular-nums text-[#1e2b58]">{money(b.cents)}</div>
                <div className="text-[10px] text-slate-400">{b.count} fact. · {Math.round((b.cents / total) * 100)}%</div>
              </button>
            );
          })}
        </div>
        {over60 > 0 && (
          <p className="mt-2 text-[12px] text-slate-700">
            <b className="text-red-600">{money(over60)}</b> tienen más de 60 días ({Math.round((over60 / total) * 100)}% del total).
            <b> Qué significa:</b> a esa edad, cada semana que pasa baja la probabilidad de cobro.
            <b> Acción:</b> revisa primero las 5 de mayor valor (lista en "Más análisis").
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------- Gráfica 3: Caja real + proyección 13 semanas ---------- */
function CashProjectionChart({ cf, cashCents }: { cf: any; cashCents: number }) {
  const [showTable, setShowTable] = useState(false);
  const exp = cf.avgWeeklyExpenseCents ?? 0;
  let opt = cashCents, pes = cashCents;
  const pts = cf.weeks.map((w: any, i: number) => {
    opt = opt + w.inflowCents - exp;
    pes = pes - exp;
    return { i: i + 1, start: w.start, opt, pes, inflow: w.inflowCents };
  });
  const W = 720, H = 180, PAD = 8;
  const vals = [cashCents, ...pts.map((p: any) => p.opt), ...pts.map((p: any) => p.pes)];
  const min = Math.min(0, ...vals), max = Math.max(1, ...vals);
  const x = (i: number) => PAD + (i / 13) * (W - PAD * 2);
  const y = (c: number) => 12 + (1 - (c - min) / (max - min)) * (H - 24);
  const lineOf = (key: "opt" | "pes") =>
    `M${x(0)},${y(cashCents)} ` + pts.map((p: any) => `L${x(p.i)},${y(p[key])}`).join(" ");
  const band = `M${x(0)},${y(cashCents)} ` + pts.map((p: any) => `L${x(p.i)},${y(p.opt)}`).join(" ")
    + ` L${x(13)},${y(pts[12].pes)} ` + [...pts].reverse().slice(1).map((p: any) => `L${x(p.i)},${y(p.pes)}`).join(" ") + ` Z`;
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
        Caja: hoy y las próximas 13 semanas
      </div>
      <p className="px-4 pt-2 text-[12px] text-slate-500">
        Parte de tu caja real de hoy ({money(cashCents)}) y proyecta un rango: la línea de arriba supone que todos pagan a tiempo; la de abajo, que nadie paga. La realidad casi siempre cae en la franja del medio.
      </p>
      <div className="px-2 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full min-w-[480px]">
          {min < 0 && <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="#ef4444" strokeDasharray="4 3" strokeWidth="1" />}
          <path d={band} fill="#1e2b58" opacity="0.08" />
          <path d={lineOf("opt")} fill="none" stroke="#059669" strokeWidth="2" strokeDasharray="5 4" />
          <path d={lineOf("pes")} fill="none" stroke="#b91c1c" strokeWidth="2" strokeDasharray="5 4" />
          <circle cx={x(0)} cy={y(cashCents)} r="4" fill="#1e2b58"><title>{`Hoy: ${money(cashCents)} (dato real)`}</title></circle>
          {pts.map((p: any) => (
            <g key={p.i}>
              <circle cx={x(p.i)} cy={y(p.opt)} r="2.5" fill="#059669"><title>{`S${p.i} (${p.start}) si todos pagan a tiempo: ${money(p.opt)} · cobros esperados ${money(p.inflow)}`}</title></circle>
              <circle cx={x(p.i)} cy={y(p.pes)} r="2.5" fill="#b91c1c"><title>{`S${p.i} (${p.start}) si nadie paga: ${money(p.pes)}`}</title></circle>
            </g>
          ))}
          {[0, 4, 8, 13].map((i) => (
            <text key={i} x={x(i)} y={H + 12} textAnchor="middle" fontSize="9" fill="#94a3b8">{i === 0 ? "Hoy" : `S${i}`}</text>
          ))}
        </svg>
      </div>
      <div className="px-4 pb-2 space-y-1">
        <div className="flex flex-wrap gap-3 text-[10px] text-slate-500">
          <span><span className="inline-block size-2 rounded-full bg-[#1e2b58] mr-1" />Dato real (hoy)</span>
          <span><span className="inline-block w-3 border-t-2 border-dashed border-emerald-600 mr-1 align-middle" />Si todos pagan a su vencimiento</span>
          <span><span className="inline-block w-3 border-t-2 border-dashed border-red-700 mr-1 align-middle" />Si nadie paga (solo gastos)</span>
        </div>
        <p className="text-[11px] text-slate-400">
          Suposiciones: cobros = fechas de vencimiento reales de QuickBooks ({cf.overdueCents > 0 ? `lo ya vencido, ${money(cf.overdueCents)}, NO se cuenta — hay que gestionarlo` : "sin vencidos"}); gastos = tu promedio real de las últimas 12 semanas ({money(exp)}/semana). Es una proyección, no una garantía. Nómina e impuestos futuros no confirmados no están incluidos.
        </p>
        <button onClick={() => setShowTable((v) => !v)} className="text-[11px] text-slate-500 underline">
          {showTable ? "Ocultar tabla semana a semana" : "Ver tabla semana a semana"}
        </button>
        {showTable && (
          <table className="w-full text-[12px]">
            <thead><tr className="text-[9px] uppercase text-slate-400"><th className="text-left">Semana</th><th className="text-right">Cobros esperados</th><th className="text-right">Gastos (ref.)</th><th className="text-right">Rango proyectado</th></tr></thead>
            <tbody>
              {pts.map((p: any) => (
                <tr key={p.i} className="border-t border-slate-100">
                  <td className="py-0.5">S{p.i} · {p.start}</td>
                  <td className="text-right tabular-nums text-emerald-700">{p.inflow ? money(p.inflow) : "—"}</td>
                  <td className="text-right tabular-nums text-slate-500">{money(exp)}</td>
                  <td className="text-right tabular-nums font-semibold">{money(p.pes)} – {money(p.opt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ---------- Gráfica 4: Completado sin facturar ---------- */
function CbnbBars({ cbnb, onOpen }: { cbnb: any; onOpen: () => void }) {
  const groups = [
    { k: "0-2", label: "0-2 días", color: "#94a3b8" },
    { k: "3-7", label: "3-7 días", color: "#fbbf24" },
    { k: "8-14", label: "8-14 días", color: "#f97316" },
    { k: "14+", label: "+14 días", color: "#b91c1c" },
  ];
  const max = Math.max(1, ...groups.map((g) => cbnb[g.k] ?? 0));
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
        Trabajo terminado que aún no se factura ({cbnb.total})
      </div>
      <p className="px-4 pt-2 text-[12px] text-slate-500">
        Cada trabajo aquí es dinero que no entra hasta que se facture. Meta interna: facturar en 24-48 h. Toca una barra para abrir la lista.
      </p>
      <div className="px-4 py-3 grid grid-cols-4 gap-3 items-end h-36">
        {groups.map((g) => (
          <button key={g.k} onClick={onOpen} className="flex flex-col items-center justify-end h-full gap-1">
            <span className="text-sm font-extrabold tabular-nums text-[#1e2b58]">{cbnb[g.k] ?? 0}</span>
            <div className="w-full rounded-t" style={{ background: g.color, height: `${((cbnb[g.k] ?? 0) / max) * 80}%`, minHeight: (cbnb[g.k] ?? 0) > 0 ? 6 : 2 }} />
            <span className="text-[10px] text-slate-500">{g.label}</span>
          </button>
        ))}
      </div>
      <p className="px-4 pb-2.5 text-[11px] text-slate-400">
        {cbnb.valueNote}{cbnb.unknown ? ` · ${cbnb.unknown} trabajos sin fecha de fin conocida.` : ""} Fuente: Airtable + facturas FTS OS.
      </p>
    </div>
  );
}

/* ---------- Más análisis: gastos por categoría ---------- */
function OpexCategories({ cur, prev }: { cur: any; prev: any }) {
  if (!cur?.categories?.length) return null;
  const prevByName = new Map<string, number>((prev?.categories ?? []).map((c: any) => [c.name, c.cents]));
  const top = cur.categories.slice(0, 10);
  const max = Math.max(1, ...top.map((c: any) => c.cents));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">
        ¿En qué se va el dinero? — gastos del periodo por categoría (top 10)
      </div>
      {top.map((c: any) => {
        const pv = prevByName.get(c.name);
        return (
          <div key={c.name} className="py-1">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600 truncate mr-2">{c.name}</span>
              <span className="tabular-nums font-semibold">
                {money(c.cents)}
                {pv != null && pv > 0 && (
                  <span className={cn("ml-1 text-[10px]", c.cents > pv ? "text-red-600" : "text-emerald-600")}>
                    {c.cents > pv ? "▲" : "▼"}{Math.abs(Math.round(((c.cents - pv) / pv) * 100))}%
                  </span>
                )}
              </span>
            </div>
            <div className="h-1.5 rounded bg-slate-100"><div className="h-full rounded bg-[#e8542f]/70" style={{ width: `${(c.cents / max) * 100}%` }} /></div>
          </div>
        );
      })}
      <p className="mt-1 text-[10px] text-slate-400">Fuente: P&L de QuickBooks · comparación contra el periodo anterior equivalente.</p>
    </div>
  );
}

/* ---------- Más análisis: obligaciones ---------- */
function Obligations({ ob }: { ob: any }) {
  const Section = ({ title, rows, tone }: { title: string; rows: any[]; tone?: string }) =>
    rows?.length ? (
      <div>
        <div className={cn("text-[10px] font-bold uppercase tracking-wide", tone ?? "text-slate-500")}>{title}</div>
        {rows.map((a: any) => (
          <div key={a.name} className="flex justify-between text-sm py-0.5">
            <span className="text-slate-600 truncate mr-2">{a.name}</span>
            <span className="tabular-nums font-semibold">{money(a.cents)}</span>
          </div>
        ))}
      </div>
    ) : null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Obligaciones registradas en QuickBooks (lo que hay que pagar)
      </div>
      <Section title="Proveedores (AP)" rows={ob.ap} />
      <Section title="Impuestos (GST / income tax)" rows={ob.tax} tone="text-amber-600" />
      <Section title="Tarjetas de crédito" rows={ob.creditCards} />
      <Section title="Préstamos" rows={ob.loans} />
      <Section title="Otros pasivos corrientes" rows={ob.otherCurrent} />
      {ob.intercompany?.length > 0 && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-2">
          <Section title="Intercompany / Holding — separado de la operación" rows={ob.intercompany} tone="text-indigo-600" />
        </div>
      )}
      <p className="text-[10px] text-slate-400">{ob.payrollNote} · Saldos actuales de cuentas de pasivo en QuickBooks; las fechas exactas de pago no están registradas ahí.</p>
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
                    <td className="px-2 text-right tabular-nums font-semibold">
                      {money(r.totalCents)}
                      {r.qbBalanceCents != null && (
                        <span className="block text-[10px] font-normal text-emerald-700">
                          QB debe: {money(r.qbBalanceCents)}
                        </span>
                      )}
                    </td>
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
