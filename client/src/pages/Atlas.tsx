import { useEffect, useMemo, useRef, useState } from "react";
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
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
                  Trabajos completados sin factura ({s.unbilled.withoutInvoice}) — los más viejos primero
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
                      {s.unbilled.jobs.map((j: any) => (
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
                      {s.unbilled.jobs.length === 0 && (
                        <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                          Nada pendiente — todo lo completado está facturado ✔
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null
        )}

        {tab !== "Snapshot" && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            <p className="font-semibold text-slate-600 mb-1">{tab}</p>
            {tab === "CFO" || tab === "Collections"
              ? "Se completa al conectar QuickBooks (F1d) — nada se muestra sin datos reales."
              : "En construcción — próxima fase del plan aprobado."}
          </div>
        )}
      </main>
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
