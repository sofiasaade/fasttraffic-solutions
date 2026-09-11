import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, ShieldCheck, LogOut, RefreshCw, Landmark, FileWarning,
  Receipt, TrendingUp, Lock, Eye, EyeOff,
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
        toast.info("Signed out due to inactivity");
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
      if (!r.ok) return void toast.error(r.error ?? "Couldn't change the password");
      toast.success("Permanent password saved ✔");
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
      if (!r.ok) return void toast.error(r.error ?? "The code didn't match — use the newest one in the app");
      toast.success("MFA activated ✔");
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
          <div className="text-xl font-extrabold">Secure your account</div>
          <p className="text-xs text-white/60 mt-1">
            ATLAS shows your banks and receivables — the server won't hand out any data
            until {needsPassword && needsMfa ? "these 2 steps are" : "this step is"} completed (one time only).
          </p>
        </div>

        {needsPassword && (
          <div className={cn("rounded-2xl bg-white p-5 space-y-2.5", passDone && "opacity-60")}>
            <div className="font-bold text-[#1e2b58] text-sm">
              {passDone ? "✔ Permanent password created" : "1 · Create your permanent password"}
            </div>
            {!passDone && (
              <>
                <PasswordInput placeholder="Current password (the temporary one)" value={current} onChange={setCurrent} />
                <PasswordInput placeholder="New password (min. 10 characters)" value={newPass} onChange={setNewPass} />
                <Button className="w-full bg-[#1e2b58]" disabled={busy || newPass.length < 10 || !current} onClick={changePass}>
                  Save password
                </Button>
              </>
            )}
          </div>
        )}

        {needsMfa && (
          <div className={cn("rounded-2xl bg-white p-5 space-y-2.5", mfaDone && "opacity-60")}>
            <div className="font-bold text-[#1e2b58] text-sm">
              {mfaDone ? "✔ MFA activated" : `${needsPassword ? "2" : "1"} · Activate your security code (MFA)`}
            </div>
            {!mfaDone && (
              <>
                <ol className="list-decimal pl-4 space-y-1 text-[13px] text-slate-600">
                  <li>On your phone, open <b>Google Authenticator</b> (free on the App Store / Play Store).</li>
                  <li>Tap <b>+</b> → "Enter a setup key" → account: <b>FTS ATLAS</b> → paste this key:</li>
                </ol>
                <div className="rounded-lg bg-slate-100 p-2 text-center font-mono text-xs break-all select-all">
                  {secret ?? "…"}
                </div>
                {uri && (
                  <a href={uri} className="block text-center text-xs text-[#e8542f] underline">
                    (on your phone? tap here and it adds itself)
                  </a>
                )}
                <Input placeholder="6-digit code (use a freshly generated one)" inputMode="numeric" value={code}
                  onChange={(e) => setCode(e.target.value)} />
                <Button className="w-full bg-[#1e2b58]" disabled={busy || code.replace(/\s/g, "").length < 6} onClick={confirmMfa}>
                  Confirm and activate
                </Button>
                <p className="text-[11px] text-slate-400">
                  The code changes every 30s — type the one on screen and confirm right away.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


/** Password field with a show/hide toggle (Sofia, Sep 11 2026). */
function PasswordInput({ placeholder, value, onChange }: {
  placeholder: string; value: string; onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input placeholder={placeholder} type={show ? "text" : "password"} value={value}
        onChange={(e) => onChange(e.target.value)} className="pr-9" />
      <button type="button" tabIndex={-1} onClick={() => setShow((v) => !v)}
        title={show ? "Hide" : "Show what I'm typing"}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
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
        toast.error(r.error ?? "Couldn't sign in");
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
      if (!r.ok) return void toast.error(r.error ?? "Wrong code");
      toast.success("MFA activated ✔");
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
      if (!r.ok) return void toast.error(r.error ?? "Couldn't change it");
      toast.success("Password updated ✔");
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
          <div className="text-xs text-slate-500">Executive Command Center · private access</div>
        </div>

        {step === "login" && (
          <div className="space-y-2.5">
            <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <PasswordInput placeholder="Password" value={password} onChange={setPassword} />
            <Input placeholder="Google Authenticator code (REQUIRED once MFA is active)" inputMode="numeric" value={totp} onChange={(e) => setTotp(e.target.value)} />
            <Button className="w-full bg-[#1e2b58] hover:bg-[#2a3a72]" disabled={busy || !email || !password} onClick={doLogin}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4 mr-1" />} Sign in
            </Button>
          </div>
        )}

        {step === "totp-setup" && (
          <div className="space-y-3 text-sm">
            <p className="font-semibold text-[#1e2b58]">Activate your MFA (one time only)</p>
            <ol className="list-decimal pl-4 space-y-1 text-slate-600 text-[13px]">
              <li>Open Google Authenticator or 1Password on your phone.</li>
              <li>Add an account with this manual key:</li>
            </ol>
            <div className="rounded-lg bg-slate-100 p-2 text-center font-mono text-xs break-all select-all">{totpSecret}</div>
            {totpUri && (
              <a href={totpUri} className="block text-center text-xs text-[#e8542f] underline">
                or tap here from your phone to add it automatically
              </a>
            )}
            <Input placeholder="6-digit code shown in the app" inputMode="numeric" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} />
            <Button className="w-full bg-[#1e2b58]" disabled={busy || confirmCode.length < 6} onClick={confirmTotp}>
              Confirm and activate MFA
            </Button>
          </div>
        )}

        {step === "change-password" && (
          <div className="space-y-2.5">
            <p className="text-sm font-semibold text-[#1e2b58]">Create your permanent password</p>
            <PasswordInput placeholder="New password (min. 10 characters)" value={newPass} onChange={setNewPass} />
            <Button className="w-full bg-[#1e2b58]" disabled={busy || newPass.length < 10} onClick={changePassword}>
              Save and sign in
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
            <button onClick={() => snapQ.refetch()} title="Refresh" className="p-1.5 rounded hover:bg-white/10">
              <RefreshCw className={cn("size-4", snapQ.isFetching && "animate-spin")} />
            </button>
            <button onClick={onLogout} title="Sign out" className="p-1.5 rounded hover:bg-white/10">
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
                <Kpi icon={Receipt} label="Invoiced this month" value={money(s.billing.invoicedThisMonthCents)}
                  sub={`${s.billing.invoicedThisMonthCount} invoices · prior month ${money(s.billing.invoicedPrevMonthCents)}`}
                  source="FTS OS invoices" />
                <Kpi icon={Landmark} label="Outstanding (app)" value={money(s.billing.outstandingAppCents)}
                  sub={`${s.billing.outstandingAppCount} invoices sent / in QB — the accounting balance comes from QuickBooks`}
                  source="FTS OS invoices" warn={s.billing.outstandingAppCents > 0} />
                <Kpi icon={FileWarning} label="Completed NOT billed" value={String(s.unbilled.withoutInvoice)}
                  sub={`${s.unbilled.over48h} over 48h — goal: bill within 24-48h`}
                  source="Airtable + FTS OS" warn={s.unbilled.over48h > 0} />
                <Kpi icon={TrendingUp} label="Quotes pipeline" value={money(s.billing.quotesPipelineCents)}
                  sub={`${s.billing.quotesCount} saved quotes (FTS-Q)`} source="FTS OS quotes" />
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
        Completed jobs without an invoice ({jobs.length}) — oldest first
        {over48h > 0 && <span className="ml-2 text-amber-300">· {over48h} over 48h</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b">
              <th className="text-left px-4 py-2">Client</th>
              <th className="text-left px-2">Status</th>
              <th className="text-right px-2">Finished</th>
              <th className="text-right px-4">Days unbilled</th>
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
                Nothing pending — everything completed is billed ✔
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
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>FTS Weekly Report — ${today}</title>
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
<h1>Executive weekly report</h1>
<div class="sub">${today} · generated by ATLAS · sources: QuickBooks (read-only), FTS OS, Airtable</div>
<h2>Summary</h2>
<ul>${((ceo as any).summary ?? []).map((s: string) => `<li>${s}</li>`).join("")}</ul>
<h2>Key figures</h2>
<div class="kpis">
  <div class="kpi"><span>Cash in banks (QB)</span><b>${m(cf?.cash?.totalCents)}</b></div>
  <div class="kpi"><span>Accounts receivable (QB)</span><b>${m(cf?.ar?.totalCents)}</b></div>
  <div class="kpi"><span>Overdue 60+ days (QB)</span><b>${m(cf?.ar ? (cf.ar.buckets["61-90"] ?? 0) + (cf.ar.buckets["90+"] ?? 0) : null)}</b></div>
  <div class="kpi"><span>Invoiced this month (app)</span><b>${m((ceo as any).ops.invoicedThisMonthCents)}</b></div>
  <div class="kpi"><span>Unbilled jobs</span><b>${(ceo as any).ops.unbilledJobs ?? "—"}</b></div>
</div>
<h2>Monthly trend (QuickBooks P&L)</h2>
<table><tr><th>Month</th><th class="r">Income</th><th class="r">Expenses</th><th class="r">Net</th></tr>
${months.map((x: any) => `<tr><td>${x.title}</td><td class="r">${m(x.incomeCents)}</td><td class="r">${m(x.expensesCents)}</td><td class="r">${m(x.netCents)}</td></tr>`).join("")}
</table>
<h2>Collections</h2>
<ul>
  <li>${coll.rows.length} open invoices in the app worth ${m(coll.outstandingCents)}.</li>
  <li>${promises.length} with a promise to pay · ${disputes.length} in dispute.</li>
  ${cf?.ar?.topCustomers?.length ? `<li>Largest debtors (QB): ${cf.ar.topCustomers.slice(0, 3).map((t: any) => `${t.name} (${m(t.cents)})`).join(" · ")}</li>` : ""}
</ul>
<h2>My priorities</h2>
<ul>
  <li>${openPrios.length} active priorities · ${overduePrios.length} overdue.</li>
  ${overduePrios.slice(0, 5).map((p: any) => `<li>OVERDUE: ${p.title} (${p.dueDate})</li>`).join("")}
</ul>
<div class="foot">Confidential — for Fast Traffic Solutions Ltd. management only. Figures pulled live at generation time; nothing is estimated.</div>
<script>window.print()</script>
</body></html>`;
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); }
    } catch (e: any) {
      toast.error("Couldn't generate the report: " + (e?.message ?? ""));
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
          {printing && <Loader2 className="size-3.5 animate-spin mr-1" />} 🖨 Weekly report
        </Button>
      </div>
      {/* Written summary */}
      {c.summary?.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Executive summary</div>
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
            Income vs expenses by month — QuickBooks P&L
          </div>
          <div className="flex items-end gap-3 h-44">
            {months.map((m: any) => (
              <div key={m.title} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div className="text-[10px] tabular-nums font-bold text-[#1e2b58]">
                  {money(m.incomeCents).replace(".00", "")}
                </div>
                <div className="w-full flex items-end gap-0.5 flex-1">
                  <div className="flex-1 bg-[#1e2b58] rounded-t"
                    style={{ height: `${(m.incomeCents / maxIncome) * 100}%` }} title={`Income ${money(m.incomeCents)}`} />
                  <div className="flex-1 bg-[#e8542f]/70 rounded-t"
                    style={{ height: `${(m.expensesCents / maxIncome) * 100}%` }} title={`Expenses ${money(m.expensesCents)}`} />
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
            <span><span className="inline-block size-2 bg-[#1e2b58] rounded-sm mr-1" />Income</span>
            <span><span className="inline-block size-2 bg-[#e8542f]/70 rounded-sm mr-1" />Expenses</span>
            <span>Net under each month</span>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          {c.qbConnected ? "No P&L data yet." : "The monthly trend comes from QuickBooks — connect it in CFO."}
        </div>
      )}

      <JobsCompare />

      <EarnedIncome />

      {/* Ops pulse */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Receipt} label="Invoiced this month (app)" value={money(c.ops.invoicedThisMonthCents)}
          sub={`${c.ops.invoicedThisMonthCount} invoices`} source="FTS OS" />
        <Kpi icon={FileWarning} label="Not billed" value={c.ops.unbilledJobs != null ? String(c.ops.unbilledJobs) : "—"}
          sub="completed jobs without an invoice" source="Airtable + FTS OS" warn={(c.ops.unbilledJobs ?? 0) > 0} />
        <Kpi icon={TrendingUp} label="Quotes pipeline" value={money(c.ops.quotesCents)}
          sub={`${c.ops.quotesCount} quotes`} source="FTS OS" />
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Profitability per job</div>
          <div className="mt-1 text-sm font-semibold text-slate-500">Not available</div>
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
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${names[Number(m) - 1]} ${y}`;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
        Net by WORK month — income counts when the project was done, not when it was invoiced
      </div>
      <div className="px-4 py-2 text-[12px] text-slate-600 bg-slate-50 border-b">
        {Math.round(c.coverage * 100)}% of the income could be attributed to its real work month
        (service date on the invoice, or the project end date in Airtable).
        The rest is shown separately as "invoice month".
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b">
              <th className="text-left px-4 py-1.5">Month</th>
              <th className="text-right px-2">Work performed</th>
              <th className="text-right px-2">No date (invoice month)</th>
              <th className="text-right px-2">Expenses</th>
              <th className="text-right px-4">Net for the month</th>
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
                  {m.netCents != null ? money(m.netCents) : "no QB expenses"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px] text-slate-400">
        Source: QuickBooks invoices reassigned to their work month + monthly QuickBooks P&L expenses.
        {c.window?.capped && " History limited to the latest 1000 invoices."}
      </p>
      {c.errors?.length > 0 && (
        <div className="mx-4 mb-3 rounded-lg bg-amber-50 border border-amber-200 p-2 text-[12px] text-amber-800">
          <ul className="list-disc pl-4">{c.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
    </div>
  );
}


/* ============ COMPARATIVA ANUAL DE TRABAJOS (Sofia, Sep 11) ============ */

const MES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function JobsCompare() {
  const q = trpc.atlas.jobsCompare.useQuery(undefined, { refetchInterval: 15 * 60_000 });
  const [showClients, setShowClients] = useState(true);
  if (q.isLoading)
    return <div className="py-8 flex justify-center"><Loader2 className="size-5 animate-spin text-slate-400" /></div>;
  const c: any = q.data;
  if (!c) return null;
  const maxM = Math.max(1, ...c.months.flatMap((m: any) => [m.cur, m.prev]));
  const up = (c.ytd.deltaPct ?? 0) >= 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
        Are we doing better than last year? — jobs {c.curYear} vs {c.prevYear}
      </div>

      {/* Veredicto grande y simple */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-100">
        <div>
          <div className="text-[10px] font-bold uppercase text-slate-400">This year (Jan 1 → today)</div>
          <div className="text-3xl font-extrabold tabular-nums text-[#1e2b58]">{c.ytd.cur}</div>
          <div className="text-[11px] text-slate-500">jobs</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-slate-400">Same period {c.prevYear}</div>
          <div className="text-3xl font-extrabold tabular-nums text-slate-400">{c.ytd.prev}</div>
          <div className="text-[11px] text-slate-500">jobs</div>
        </div>
        {c.ytd.deltaPct != null && (
          <div className={cn("rounded-xl px-4 py-2 text-center", up ? "bg-emerald-50" : "bg-red-50")}>
            <div className={cn("text-2xl font-extrabold tabular-nums", up ? "text-emerald-600" : "text-red-600")}>
              {up ? "▲" : "▼"} {Math.abs(c.ytd.deltaPct)}%
            </div>
            <div className={cn("text-[11px] font-semibold", up ? "text-emerald-700" : "text-red-700")}>
              {up ? "more jobs than last year" : "fewer jobs than last year"}
            </div>
          </div>
        )}
        <div className="text-[11px] text-slate-500 leading-snug">
          Active clients: <b>{c.activeClientsCur}</b> this year vs <b>{c.activeClientsPrev}</b> last year.<br />
          Full {c.prevYear} closed with <b>{c.prevFullTotal}</b> jobs.
        </div>
      </div>

      {/* Month by month */}
      <div className="px-4 pt-3">
        <div className="flex items-end gap-1.5 h-32">
          {c.months.map((m: any) => (
            <div key={m.month} className={cn("flex-1 flex flex-col items-center gap-0.5 min-w-0", m.future && "opacity-30")}>
              <div className="text-[9px] tabular-nums font-bold text-[#1e2b58]">
                {m.future ? "" : m.cur}<span className="text-slate-400 font-normal">{m.prev ? `/${m.prev}` : ""}</span>
              </div>
              <div className="w-full flex items-end gap-px flex-1">
                <div className="flex-1 bg-[#1e2b58] rounded-t" style={{ height: `${(m.cur / maxM) * 100}%`, minHeight: m.cur ? 3 : 0 }}
                  title={`${MES[Number(m.month) - 1]} ${c.curYear}: ${m.cur} jobs${m.partial ? " (month in progress)" : ""}`} />
                <div className="flex-1 bg-slate-300 rounded-t" style={{ height: `${(m.prev / maxM) * 100}%`, minHeight: m.prev ? 3 : 0 }}
                  title={`${MES[Number(m.month) - 1]} ${c.prevYear}: ${m.prev} jobs`} />
              </div>
              <div className="text-[9px] text-slate-500">{MES[Number(m.month) - 1]}{m.partial && "*"}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-4 text-[10px] text-slate-500 pt-1.5">
          <span><span className="inline-block size-2 bg-[#1e2b58] rounded-sm mr-1" />{c.curYear}</span>
          <span><span className="inline-block size-2 bg-slate-300 rounded-sm mr-1" />{c.prevYear}</span>
          <span>* month in progress</span>
        </div>
      </div>

      {/* Por cliente */}
      <button onClick={() => setShowClients((v) => !v)}
        className="mx-4 my-2.5 text-[12px] font-semibold text-slate-600 underline">
        {showClients ? "Hide client detail" : "Show client detail"}
      </button>
      {showClients && (
        <div className="px-4 pb-4 space-y-3">
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b bg-slate-50">
                  <th className="text-left px-3 py-1.5">Client</th>
                  <th className="text-right px-2">{c.prevYear} (same period)</th>
                  <th className="text-right px-2">{c.curYear}</th>
                  <th className="text-right px-3">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {c.topClients.map((t: any) => (
                  <tr key={t.name}>
                    <td className="px-3 py-1.5 font-medium truncate max-w-[220px]">{t.name}</td>
                    <td className="px-2 text-right tabular-nums text-slate-500">{t.prevYtd}</td>
                    <td className="px-2 text-right tabular-nums font-bold text-[#1e2b58]">{t.curYtd}</td>
                    <td className={cn("px-3 text-right tabular-nums font-semibold",
                      t.delta > 0 ? "text-emerald-600" : t.delta < 0 ? "text-red-600" : "text-slate-400")}>
                      {t.delta > 0 ? "▲ +" : t.delta < 0 ? "▼ " : "= "}{t.delta !== 0 ? t.delta : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {c.lostClients.length > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-100 p-3">
                <div className="text-[10px] font-bold uppercase text-red-600 mb-1">
                  They gave us work last year and NOTHING this year — should we call them?
                </div>
                {c.lostClients.map((t: any) => (
                  <div key={t.name} className="flex justify-between text-[12px] py-0.5">
                    <span className="text-slate-700 truncate mr-2">{t.name}</span>
                    <span className="tabular-nums text-red-600 font-semibold">{t.prevYtd} in {c.prevYear}</span>
                  </div>
                ))}
              </div>
            )}
            {c.newClients.length > 0 && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3">
                <div className="text-[10px] font-bold uppercase text-emerald-700 mb-1">
                  NEW clients this year (didn't exist in {c.prevYear})
                </div>
                {c.newClients.map((t: any) => (
                  <div key={t.name} className="flex justify-between text-[12px] py-0.5">
                    <span className="text-slate-700 truncate mr-2">{t.name}</span>
                    <span className="tabular-nums text-emerald-700 font-semibold">{t.curYtd} jobs</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-[10px] text-slate-400">
            Source: Airtable (job start month; cancelled and permit-declined excluded) · history since {c.coverageFrom} · updated {c.asOf}.
          </p>
        </div>
      )}
    </div>
  );
}

/* ============ IMPUESTOS — VISTA APROXIMADA (Sofia, Sep 11) ============ */

function TaxCard() {
  const q = trpc.atlas.taxEstimate.useQuery(undefined, { refetchInterval: 30 * 60_000 });
  const c: any = q.data;
  if (q.isLoading)
    return <div className="py-6 flex justify-center"><Loader2 className="size-5 animate-spin text-slate-400" /></div>;
  if (!c?.connected) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
        Taxes — how much to set aside (approximate view)
      </div>
      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-100 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">GST payable (per the books)</div>
          <div className="mt-0.5 text-xl font-extrabold tabular-nums text-[#1e2b58]">
            {c.gstCents != null ? money(c.gstCents) : "Not available"}
          </div>
          <div className="text-[10px] text-slate-400">FACT · GST/HST accounts in QuickBooks</div>
        </div>
        <div className="rounded-lg border border-slate-100 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">Corporate tax on profit earned so far</div>
          <div className="mt-0.5 text-xl font-extrabold tabular-nums text-amber-700">
            {c.taxYtdCents != null ? "≈ " + money(c.taxYtdCents) : "Not available"}
          </div>
          <div className="text-[10px] text-slate-400">
            ESTIMATE · YTD net profit {c.netYtdCents != null ? money(c.netYtdCents) : "n/a"} × 11% combined federal (9%) + Alberta (2%) small-business rate{c.netYtdCents > 50000000 ? "; the excess over $500K at 23% combined" : ""}
          </div>
        </div>
        <div className="rounded-lg border border-slate-100 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">Full-year projection (if the pace holds)</div>
          <div className="mt-0.5 text-xl font-extrabold tabular-nums text-slate-600">
            {c.projection ? "≈ " + money(c.projection.taxFullYearCents) : "Not available"}
          </div>
          <div className="text-[10px] text-slate-400">
            INFERENCE · annualized profit {c.projection ? money(c.projection.annualizedNetCents) : "n/a"} (day {c.projection?.dayOfYear} of 365)
          </div>
        </div>
      </div>
      <p className="px-4 pb-3 text-[11px] text-slate-500">
        <b>What this means:</b> set aside ~11% of every dollar of net profit and corporate tax won't surprise you in April.
        Accounting profit is not identical to taxable income (depreciation, adjustments) — <b>this number is a guide for setting money aside, not a replacement for your accountant</b>. ATLAS files and pays nothing.
      </p>
      {c.errors?.length > 0 && (
        <div className="mx-4 mb-3 rounded-lg bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-800">
          {c.errors.join(" · ")}
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
        Client analytics come from the QuickBooks invoice history — connect it in the CFO tab.
      </div>
    );
  const y = c.year;
  return (
    <div className="space-y-4">
      {y && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Kpi icon={Receipt} label={`Invoiced ${y.from.slice(0, 4)}`} value={money(y.totalCents)}
              sub={`${y.customers} clients invoiced this year`} source="QuickBooks" />
            <Kpi icon={TrendingUp} label="Top-3 concentration" value={`${Math.round(y.top3Share * 100)}%`}
              sub={y.top3Share > 0.6 ? "Heavy dependence on few clients — a risk to watch" : "Reasonably diversified client base"}
              source="QuickBooks" warn={y.top3Share > 0.6} />
            <Kpi icon={Landmark} label="New clients (6 months)"
              value={String((c.newByMonth ?? []).reduce((n: number, m: any) => n + m.newCustomers, 0))}
              sub="first invoice within that period" source="QuickBooks" />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
              Where {y.from.slice(0, 4)} revenue comes from — top 10 clients
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
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">New clients by month</div>
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
          Source: {c.window.count} QuickBooks invoices ({c.window.from} → {c.window.to}).
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
        13-week cash — inflows from real due dates, expenses = your actual 12-week average
      </div>
      <div className="px-4 py-2 text-[12px] text-slate-600 border-b bg-slate-50 flex flex-wrap gap-x-5 gap-y-1">
        <span>Cash today: <b className="tabular-nums">{money(c.cashCents ?? 0)}</b></span>
        {c.overdueCents > 0 && (
          <span className="text-red-700">Already overdue: <b className="tabular-nums">{money(c.overdueCents)}</b> (not counted in any week — it needs collecting)</span>
        )}
        <span>Reference weekly spend: <b className="tabular-nums">{c.avgWeeklyExpenseCents != null ? money(c.avgWeeklyExpenseCents) : "not available"}</b></span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b">
              <th className="text-left px-4 py-1.5">Week</th>
              <th className="text-right px-2">Collections due</th>
              <th className="text-right px-2">Expenses (ref.)</th>
              <th className="text-right px-4">Projected cash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r: any) => (
              <tr key={r.idx} className={cn(r.running < 0 && "bg-red-50")}>
                <td className="px-4 py-1.5 text-slate-600">W{r.idx} · {r.start}</td>
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
        Inflows use the real QuickBooks due dates (if a client pays late, it shifts).
        Spend is your recent real average, as a reference — not a prediction.
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
    if (qb === "connected") toast.success("QuickBooks connected ✔ (read-only)");
    else if (qb === "denied") toast.info("Connection cancelled at Intuit.");
    else toast.error("Couldn't connect QuickBooks — try again.");
    window.history.replaceState(null, "", "/atlas");
  }, []);

  const disconnect = async () => {
    if (!confirm("Disconnect QuickBooks? Access will be revoked at Intuit.")) return;
    const r = await fetch("/api/qb/disconnect", { method: "POST" }).then((r) => r.json());
    if (r.ok) {
      toast.success("QuickBooks disconnected");
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
          <p className="font-bold text-[#1e2b58] text-lg">Connect QuickBooks</p>
          <p className="text-sm text-slate-500 mt-1">
            <b>Read-only</b> access through Intuit's official OAuth — you sign in on Intuit's page and never type your QuickBooks password here. ATLAS never creates or edits anything in QuickBooks.
          </p>
        </div>
        {st.configured ? (
          <Button className="bg-[#2CA01C] hover:bg-[#238015] text-white"
            onClick={() => { window.location.href = "/api/qb/connect"; }}>
            Connect with Intuit
          </Button>
        ) : (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-[13px] text-amber-800 text-left">
            The Intuit app keys still need configuring (QB_CLIENT_ID and QB_CLIENT_SECRET in Railway).
          </div>
        )}
      </div>
    );
  }

  const o: any = ovQ.data;
  const PERIODS: { key: typeof period; label: string }[] = [
    { key: "month", label: "This month" },
    { key: "last_month", label: "Last month" },
    { key: "quarter", label: "Quarter" },
    { key: "ytd", label: "Year (YTD)" },
    { key: "12m", label: "12 months" },
  ];
  const updatedAt = o ? new Date(o.generatedAt).toLocaleTimeString() : "";

  return (
    <div className="space-y-4">
      {/* connection + global filter */}
      <div className="flex flex-wrap items-center gap-2 justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm">
        <span className="text-emerald-800">
          <b>QuickBooks connected</b>{st.companyName ? <> — {st.companyName}</> : null} · read-only
          {o && <span className="text-emerald-700/70"> · synced {updatedAt}</span>}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => ovQ.refetch()} className="text-xs text-emerald-700 underline">Refresh</button>
          <button onClick={disconnect} className="text-xs text-emerald-700 underline">Disconnect</button>
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
          className="text-[11px] text-slate-400 underline ml-1">Reset filters</button>
      </div>

      {ovQ.isLoading && <div className="py-16 flex justify-center"><Loader2 className="size-6 animate-spin text-slate-400" /></div>}

      {o?.connected && (
        <>
          {/* ============ 1. SALUD FINANCIERA DE UN VISTAZO ============ */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi2 label="Cash available" cents={o.cash?.totalCents ?? null}
              tip="Sum of the current balances of your bank accounts in QuickBooks."
              source="QuickBooks · banks" updated={updatedAt}
              onClick={() => setShowMore(true)} />
            <Kpi2 label="Invoiced (period)" cents={o.pnl?.cur?.incomeCents ?? null} prev={o.pnl?.prev?.incomeCents ?? null}
              tip="Income from the QuickBooks P&L for the chosen period. Invoicing is not collecting."
              source="QuickBooks · P&L" updated={updatedAt} />
            <Kpi2 label="Cash collected (period)" cents={o.collected?.curCents ?? null} prev={o.collected?.prevCents ?? null}
              tip="Payments actually received from clients in the period (QuickBooks Payments records)."
              source="QuickBooks · payments" updated={updatedAt} />
            <Kpi2 label="Receivables (net)" cents={o.ar?.netCents ?? o.ar?.totalCents ?? null}
              tip={o.ar?.creditsCents != null
                ? `Open invoices ${money(o.ar.totalCents)} minus client credits and unapplied payments ${money(o.ar.creditsCents)}. This is what's truly collectible.`
                : "Open balance of every unpaid invoice."}
              source="QuickBooks · invoices − credits" updated={updatedAt}
              onClick={() => onNavigate("Collections")} />
            <Kpi2 label="OVERDUE receivables" cents={o.ar?.overdueCents ?? null} warn
              tip="The share of receivables whose due date has already passed."
              source="QuickBooks · open invoices" updated={updatedAt}
              onClick={() => onNavigate("Collections")} />
            <Kpi2 label="Completed not billed" count={o.cbnb?.total ?? null} warn={(o.cbnb?.total ?? 0) > 0}
              tip="Jobs finished or picked up in Airtable that have no invoice in the app. The dollar value can't be computed yet (no invoice exists)."
              source="Airtable + FTS OS" updated={updatedAt}
              onClick={() => onNavigate("Unbilled")} />
            <Kpi2 label="Gross margin" cents={null}
              unavailableText={o.pnl?.cur?.grossCents != null ? undefined : "Not available — your QuickBooks has no cost-of-goods (COGS) recorded; no fake margin is calculated."}
              centsOverride={o.pnl?.cur?.grossCents ?? null}
              pctOf={o.pnl?.cur?.grossCents != null ? o.pnl?.cur?.incomeCents : null}
              tip="Income minus the direct costs of the jobs (COGS). Only shown if QuickBooks has those costs recorded."
              source="QuickBooks · P&L" updated={updatedAt} />
            <Kpi2 label="Net income (period)" cents={o.pnl?.cur?.netCents ?? null} prev={o.pnl?.prev?.netCents ?? null}
              tip="What's left after all expenses for the period, per the QuickBooks P&L."
              source="QuickBooks · P&L" updated={updatedAt} />
          </div>

          {/* ============ 2. RESUMEN EJECUTIVO ============ */}
          {o.summary && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">How is the company doing? — plain-words summary</div>
              {o.summary.hechos?.length > 0 && (
                <ul className="space-y-1">{o.summary.hechos.map((t: string, i: number) => (
                  <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-slate-400 font-bold shrink-0">Fact ·</span>{t}</li>))}
                </ul>
              )}
              {o.summary.alertas?.length > 0 && (
                <ul className="space-y-1">{o.summary.alertas.map((t: string, i: number) => (
                  <li key={i} className="text-sm text-amber-800 flex gap-2"><span className="text-amber-500 font-bold shrink-0">Alert ·</span>{t}</li>))}
                </ul>
              )}
              {o.summary.acciones?.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mt-1">Review first</div>
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
          <TaxCard />

          {/* ============ 4. MÁS ANÁLISIS ============ */}
          <button onClick={() => setShowMore((v) => !v)}
            className="w-full rounded-xl border border-dashed border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">
            {showMore ? "▲ Hide extra insights" : "▼ More financial insights (expenses by category, obligations, banks, debtors)"}
          </button>
          {showMore && (
            <div className="space-y-4">
              <OpexCategories cur={o.pnl?.cur} prev={o.pnl?.prev} />
              {o.obligations && <Obligations ob={o.obligations} />}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Bank accounts</div>
                  {o.cash?.accounts?.map((a: any) => (
                    <div key={a.name} className="text-sm flex justify-between py-0.5">
                      <span className="text-slate-600 truncate mr-2">{a.name}</span>
                      <span className="tabular-nums font-semibold">{money(a.balanceCents)}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Top 5 overdue — call these first</div>
                  {o.ar?.topOverdue?.map((t: any) => (
                    <div key={t.doc} className="text-sm flex justify-between py-0.5 gap-2">
                      <span className="text-slate-600 truncate">{t.customer} <span className="text-slate-400 text-xs">#{t.doc} · {t.age} days</span></span>
                      <span className="tabular-nums font-semibold text-red-600">{money(t.cents)}</span>
                    </div>
                  ))}
                  {(o.ar?.topOverdue?.length ?? 0) === 0 && <p className="text-sm text-slate-400">Nothing overdue ✔</p>}
                </div>
              </div>
            </div>
          )}

          {o.errors?.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-[12px] text-amber-800">
              Data not available right now (only real figures are shown):
              <ul className="list-disc pl-4">{o.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
          <p className="text-[10px] text-slate-400">
            Accounting source: QuickBooks (read-only) · Operational source: Airtable + FTS OS · Period: {o.range?.cur?.start} → {o.range?.cur?.end} · Updated {updatedAt}.
            {(o.invoicesCapped || o.paymentsCapped) && " History limited to the latest 1000 records per query."}
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
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}% vs previous period
            </div>
          )}
          {delta == null && prev != null && <div className="text-[11px] text-slate-400">previous: {money(prev)}</div>}
        </>
      ) : (
        <div className="mt-1 text-sm font-semibold text-slate-400">{unavailableText ?? "Not available"}</div>
      )}
      <div className="mt-1 text-[10px] text-slate-400">{source} · {updated}</div>
    </div>
  );
}

/* ---------- Chart 1: Invoiced vs Collected ---------- */
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
        <span>Invoiced vs Collected by month</span>
        <span className="flex gap-1">
          {([3, 6, 12, 24] as const).map((m) => (
            <button key={m} onClick={() => onMonths(m)}
              className={cn("rounded px-2 py-0.5 text-[11px]", months === m ? "bg-white text-[#1e2b58]" : "bg-white/10")}>{m}m</button>
          ))}
        </span>
      </div>
      <p className="px-4 pt-2 text-[12px] text-slate-500">
        Bars are what you invoiced each month; the orange line is the money that actually came in. When the line runs well below the bars, you are financing your clients.
      </p>
      <div className="px-2 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full min-w-[480px]">
          {series.map((s, i) => (
            <g key={s.month} onClick={() => setSel(sel === s.month ? null : s.month)} className="cursor-pointer">
              <rect x={PAD + bw * i + bw * 0.15} y={y(s.invoicedCents)} width={bw * 0.7} height={H - y(s.invoicedCents)}
                fill={sel === s.month ? "#2a3a72" : "#1e2b58"} rx="2">
                <title>{`${s.month}: invoiced ${money(s.invoicedCents)} (${s.invoicedCount} inv.) · collected ${money(s.collectedCents)} (${s.collectedCount} payments)`}</title>
              </rect>
              <text x={PAD + bw * i + bw / 2} y={H + 12} textAnchor="middle" fontSize="9" fill="#94a3b8">{mesCorto(s.month)}</text>
            </g>
          ))}
          <path d={line} fill="none" stroke="#e8542f" strokeWidth="2.5" />
          {series.map((s, i) => (
            <circle key={s.month} cx={PAD + bw * i + bw / 2} cy={y(s.collectedCents)} r="3" fill="#e8542f">
              <title>{`${s.month}: collected ${money(s.collectedCents)}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      {selRow && (
        <div className="mx-4 mb-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[12px] text-slate-700">
          <b>{selRow.month}</b>: invoiced {money(selRow.invoicedCents)} across {selRow.invoicedCount} invoices · collected {money(selRow.collectedCents)} across {selRow.collectedCount} payments.
          Difference: <b className={selRow.invoicedCents - selRow.collectedCents > 0 ? "text-amber-700" : "text-emerald-700"}>{money(selRow.invoicedCents - selRow.collectedCents)}</b>
          {" "}· the invoice-by-invoice detail lives in QuickBooks.
        </div>
      )}
      <div className="px-4 pb-2 flex gap-4 text-[10px] text-slate-500">
        <span><span className="inline-block size-2 bg-[#1e2b58] rounded-sm mr-1" />Invoiced (invoice date)</span>
        <span><span className="inline-block size-2 bg-[#e8542f] rounded-full mr-1" />Collected (payment date)</span>
        <span className="text-slate-400">Source: QuickBooks{capped ? " · limited to 1000 records" : ""} · tap a month for detail</span>
      </div>
    </div>
  );
}

/* ---------- Chart 2: AR aging ---------- */
const AGING_STYLES: Record<string, { bg: string; label: string }> = {
  current: { bg: "#94a3b8", label: "Current" },
  "1-30": { bg: "#fbbf24", label: "1-30 days" },
  "31-60": { bg: "#f97316", label: "31-60 days" },
  "61-90": { bg: "#ef4444", label: "61-90 days" },
  "90+": { bg: "#b91c1c", label: "90+ days" },
};
function ArAgingBar({ ar, onOpen }: { ar: any; onOpen: () => void }) {
  const total = Math.max(1, ar.totalCents);
  const over60 = (ar.buckets["61-90"]?.cents ?? 0) + (ar.buckets["90+"]?.cents ?? 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
        How old is the money you are owed?
      </div>
      <p className="px-4 pt-2 text-[12px] text-slate-500">
        Everything receivable ({money(ar.totalCents)} across {ar.openInvoices} invoices), split by how long it has been overdue. Tap any band to open Collections.
      </p>
      <div className="px-4 py-3">
        <div className="flex h-9 w-full overflow-hidden rounded-lg cursor-pointer" onClick={onOpen}>
          {Object.entries(AGING_STYLES).map(([k, st]) => {
            const b = ar.buckets[k] ?? { cents: 0, count: 0 };
            if (!b.cents) return null;
            return (
              <div key={k} style={{ width: `${Math.max(3, (b.cents / total) * 100)}%`, background: st.bg }}
                className="h-full" title={`${st.label}: ${money(b.cents)} (${b.count} invoices)`} />
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
                <div className="text-[10px] text-slate-400">{b.count} inv. · {Math.round((b.cents / total) * 100)}%</div>
              </button>
            );
          })}
        </div>
        {over60 > 0 && (
          <p className="mt-2 text-[12px] text-slate-700">
            <b className="text-red-600">{money(over60)}</b> is more than 60 days old ({Math.round((over60 / total) * 100)}% of the total).
            <b> What this means:</b> at that age, every passing week lowers the odds of collecting.
            <b> Action:</b> review the 5 highest-value ones first (list under "More insights").
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------- Chart 3: real cash + 13-week projection ---------- */
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
        Cash: today and the next 13 weeks
      </div>
      <p className="px-4 pt-2 text-[12px] text-slate-500">
        Starts from today's real cash ({money(cashCents)}) and projects a range: the top line assumes everyone pays on time; the bottom one, nobody pays. Reality almost always lands in the band between them.
      </p>
      <div className="px-2 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full min-w-[480px]">
          {min < 0 && <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="#ef4444" strokeDasharray="4 3" strokeWidth="1" />}
          <path d={band} fill="#1e2b58" opacity="0.08" />
          <path d={lineOf("opt")} fill="none" stroke="#059669" strokeWidth="2" strokeDasharray="5 4" />
          <path d={lineOf("pes")} fill="none" stroke="#b91c1c" strokeWidth="2" strokeDasharray="5 4" />
          <circle cx={x(0)} cy={y(cashCents)} r="4" fill="#1e2b58"><title>{`Today: ${money(cashCents)} (real figure)`}</title></circle>
          {pts.map((p: any) => (
            <g key={p.i}>
              <circle cx={x(p.i)} cy={y(p.opt)} r="2.5" fill="#059669"><title>{`S${p.i} (${p.start}) if everyone pays on time: ${money(p.opt)} · expected collections ${money(p.inflow)}`}</title></circle>
              <circle cx={x(p.i)} cy={y(p.pes)} r="2.5" fill="#b91c1c"><title>{`S${p.i} (${p.start}) if nobody pays: ${money(p.pes)}`}</title></circle>
            </g>
          ))}
          {[0, 4, 8, 13].map((i) => (
            <text key={i} x={x(i)} y={H + 12} textAnchor="middle" fontSize="9" fill="#94a3b8">{i === 0 ? "Today" : `W${i}`}</text>
          ))}
        </svg>
      </div>
      <div className="px-4 pb-2 space-y-1">
        <div className="flex flex-wrap gap-3 text-[10px] text-slate-500">
          <span><span className="inline-block size-2 rounded-full bg-[#1e2b58] mr-1" />Real figure (today)</span>
          <span><span className="inline-block w-3 border-t-2 border-dashed border-emerald-600 mr-1 align-middle" />If everyone pays by their due date</span>
          <span><span className="inline-block w-3 border-t-2 border-dashed border-red-700 mr-1 align-middle" />If nobody pays (expenses only)</span>
        </div>
        <p className="text-[11px] text-slate-400">
          Assumptions: inflows = real QuickBooks due dates ({cf.overdueCents > 0 ? `the ${money(cf.overdueCents)} already overdue is NOT counted — it needs collecting` : "nothing overdue"}); expenses = your actual 12-week average ({money(exp)}/week). This is a projection, not a guarantee. Unconfirmed future payroll and taxes are not included.
        </p>
        <button onClick={() => setShowTable((v) => !v)} className="text-[11px] text-slate-500 underline">
          {showTable ? "Hide week-by-week table" : "Show week-by-week table"}
        </button>
        {showTable && (
          <table className="w-full text-[12px]">
            <thead><tr className="text-[9px] uppercase text-slate-400"><th className="text-left">Week</th><th className="text-right">Expected collections</th><th className="text-right">Expenses (ref.)</th><th className="text-right">Projected range</th></tr></thead>
            <tbody>
              {pts.map((p: any) => (
                <tr key={p.i} className="border-t border-slate-100">
                  <td className="py-0.5">W{p.i} · {p.start}</td>
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

/* ---------- Chart 4: completed but not billed ---------- */
function CbnbBars({ cbnb, onOpen }: { cbnb: any; onOpen: () => void }) {
  const groups = [
    { k: "0-2", label: "0-2 days", color: "#94a3b8" },
    { k: "3-7", label: "3-7 days", color: "#fbbf24" },
    { k: "8-14", label: "8-14 days", color: "#f97316" },
    { k: "14+", label: "14+ days", color: "#b91c1c" },
  ];
  const max = Math.max(1, ...groups.map((g) => cbnb[g.k] ?? 0));
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
        Finished work not yet billed ({cbnb.total})
      </div>
      <p className="px-4 pt-2 text-[12px] text-slate-500">
        Every job here is money that won't come in until it's billed. Internal goal: bill within 24-48h. Tap a bar to open the list.
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
        {cbnb.valueNote}{cbnb.unknown ? ` · ${cbnb.unknown} jobs with no known end date.` : ""} Source: Airtable + FTS OS invoices.
      </p>
    </div>
  );
}

/* ---------- More insights: expenses by category ---------- */
function OpexCategories({ cur, prev }: { cur: any; prev: any }) {
  if (!cur?.categories?.length) return null;
  const prevByName = new Map<string, number>((prev?.categories ?? []).map((c: any) => [c.name, c.cents]));
  const top = cur.categories.slice(0, 10);
  const max = Math.max(1, ...top.map((c: any) => c.cents));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">
        Where does the money go? — period expenses by category (top 10)
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
      <p className="mt-1 text-[10px] text-slate-400">Source: QuickBooks P&L · compared against the equivalent previous period.</p>
    </div>
  );
}

/* ---------- More insights: obligations ---------- */
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
        Obligations on the books in QuickBooks (what has to be paid)
      </div>
      <Section title="Suppliers (AP)" rows={ob.ap} />
      <Section title="Taxes (GST / income tax)" rows={ob.tax} tone="text-amber-600" />
      <Section title="Credit cards" rows={ob.creditCards} />
      <Section title="Loans" rows={ob.loans} />
      <Section title="Other current liabilities" rows={ob.otherCurrent} />
      {ob.intercompany?.length > 0 && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-2">
          <Section title="Intercompany / Holding — kept separate from operations" rows={ob.intercompany} tone="text-indigo-600" />
        </div>
      )}
      <p className="text-[10px] text-slate-400">{ob.payrollNote} · Current balances of liability accounts in QuickBooks; exact payment dates are not recorded there.</p>
    </div>
  );
}

/* ========================= F1c — COLLECTIONS ========================= */

const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
const BUCKET_LABEL: Record<string, string> = {
  current: "Current", "1-30": "1-30 days", "31-60": "31-60 days",
  "61-90": "61-90 days", "90+": "90+ days",
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
      toast.success("Follow-up saved");
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
              <div className="text-[11px] text-slate-500">{t?.count ?? 0} invoices</div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500">{data.note}</p>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-[#1e2b58] text-white text-[12px] font-bold uppercase tracking-wider">
          Receivables ({data.rows.length}) · {money(data.outstandingCents)} — most overdue first
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b">
                <th className="text-left px-4 py-2">Invoice</th>
                <th className="text-left px-2">Client</th>
                <th className="text-right px-2">Total</th>
                <th className="text-right px-2">Days</th>
                <th className="text-left px-2">Risk</th>
                <th className="text-left px-2">Follow-up</th>
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
                          QB owes: {money(r.qbBalanceCents)}
                        </span>
                      )}
                    </td>
                    <td className={cn("px-2 text-right tabular-nums font-bold",
                      r.ageDays > 60 ? "text-red-600" : r.ageDays > 30 ? "text-amber-600" : "text-slate-600")}>
                      {r.ageDays}
                      <span className="block text-[9px] font-normal text-slate-400">
                        {r.agingBasis === "due" ? "since due date" : "since issue date"}
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
                        <span className="text-emerald-700 font-semibold">Promise {r.followUp.promiseDate ?? ""} · </span>
                      )}
                      {r.followUp?.dispute && <span className="text-red-600 font-semibold">Dispute · </span>}
                      {r.followUp?.nextFollowUp ? (
                        <span className={cn(r.followUp.nextFollowUp <= today && "text-amber-700 font-semibold")}>
                          Next: {r.followUp.nextFollowUp}
                        </span>
                      ) : (
                        !r.followUp && <span className="text-slate-400">No follow-up yet</span>
                      )}
                    </td>
                    <td className="px-2 text-right">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openRow(r)}>
                        {openId === r.invoiceId ? "Close" : "Manage"}
                      </Button>
                    </td>
                  </tr>
                  {openId === r.invoiceId && (
                    <tr className="bg-slate-50">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="grid gap-2.5 md:grid-cols-3">
                          <label className="text-xs space-y-1">
                            <span className="font-semibold text-slate-600">Last contact</span>
                            <Input type="date" value={form.lastContact} onChange={(e) => set("lastContact", e.target.value)} className="h-8 bg-white" />
                          </label>
                          <label className="text-xs space-y-1 md:col-span-2">
                            <span className="font-semibold text-slate-600">Contact outcome</span>
                            <Input value={form.contactOutcome} placeholder="E.g.: spoke with AP, they say they pay Friday" onChange={(e) => set("contactOutcome", e.target.value)} className="h-8 bg-white" />
                          </label>
                          <label className="text-xs space-y-1">
                            <span className="font-semibold text-slate-600">Next follow-up</span>
                            <Input type="date" value={form.nextFollowUp} onChange={(e) => set("nextFollowUp", e.target.value)} className="h-8 bg-white" />
                          </label>
                          <label className="text-xs space-y-1">
                            <span className="font-semibold text-slate-600">Responsible</span>
                            <Input value={form.responsible} placeholder="Sofia / husband / bookkeeper" onChange={(e) => set("responsible", e.target.value)} className="h-8 bg-white" />
                          </label>
                          <label className="text-xs space-y-1">
                            <span className="font-semibold text-slate-600">Risk</span>
                            <select value={form.riskLevel} onChange={(e) => set("riskLevel", e.target.value)}
                              className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs">
                              <option value="low">Low</option>
                              <option value="med">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </label>
                          <div className="text-xs space-y-1.5">
                            <label className="flex items-center gap-2 font-semibold text-slate-600">
                              <input type="checkbox" checked={form.promiseToPay} onChange={(e) => set("promiseToPay", e.target.checked)} />
                              Promise to pay
                            </label>
                            {form.promiseToPay && (
                              <Input type="date" value={form.promiseDate} onChange={(e) => set("promiseDate", e.target.value)} className="h-8 bg-white" />
                            )}
                          </div>
                          <div className="text-xs space-y-1.5 md:col-span-2">
                            <label className="flex items-center gap-2 font-semibold text-slate-600">
                              <input type="checkbox" checked={form.dispute} onChange={(e) => set("dispute", e.target.checked)} />
                              In dispute
                            </label>
                            {form.dispute && (
                              <Input value={form.disputeNote} placeholder="What is the client disputing?" onChange={(e) => set("disputeNote", e.target.value)} className="h-8 bg-white" />
                            )}
                          </div>
                          <label className="text-xs space-y-1 md:col-span-3">
                            <span className="font-semibold text-slate-600">Notes</span>
                            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2}
                              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs" />
                          </label>
                        </div>
                        <div className="mt-2 flex justify-end">
                          <Button size="sm" className="bg-[#1e2b58]" disabled={update.isPending} onClick={() => save(r.invoiceId)}>
                            {update.isPending && <Loader2 className="size-3.5 animate-spin mr-1" />} Save follow-up
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {data.rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No open receivables ✔
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

const PRIO_CATEGORIES = ["CEO", "CFO", "CMO", "Operations", "Sales", "People", "Technology", "Safety"];
const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  waiting: "Waiting",
  delegated: "Delegated",
  decision_required: "Needs decision",
  completed: "Completed",
  cancelled: "Cancelled",
};
const PRIO_DOT: Record<string, string> = {
  high: "bg-red-500", med: "bg-amber-500", low: "bg-slate-400",
};
type PrioView = "today" | "week" | "overdue" | "waiting" | "delegated" | "all" | "done";
const PRIO_VIEWS: { key: PrioView; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "overdue", label: "Overdue" },
  { key: "waiting", label: "Waiting" },
  { key: "delegated", label: "Delegated" },
  { key: "all", label: "All active" },
  { key: "done", label: "Completed" },
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
        <Input value={title} placeholder="New priority… (Enter to add)" className="h-9 flex-1 min-w-[220px]"
          onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-md border border-slate-200 px-2 text-sm">
          {PRIO_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={prio} onChange={(e) => setPrio(e.target.value as any)}
          className="h-9 rounded-md border border-slate-200 px-2 text-sm">
          <option value="high">High</option>
          <option value="med">Medium</option>
          <option value="low">Low</option>
        </select>
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-9 w-[150px]" />
        <Button className="h-9 bg-[#1e2b58]" disabled={!title.trim() || create.isPending} onClick={add}>Add</Button>
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
                  <span className="ml-2 text-[11px] text-amber-600">waiting on {r.waitingOn}</span>
                )}
              </button>
              <select value={r.status}
                onChange={(e) => update.mutate({ id: r.id, status: e.target.value as any })}
                className="h-7 rounded-md border border-slate-200 px-1.5 text-[11px] text-slate-600">
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button className="p-1 text-slate-300 hover:text-red-500" title="Delete"
                onClick={() => { if (confirm("Delete this priority?")) del.mutate({ id: r.id }); }}>
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
            {view === "done" ? "Nothing completed yet." : "No priorities in this view — add one above."}
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
          <span className="font-semibold text-slate-600">Next action</span>
          <Input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="h-8 bg-white" />
        </label>
        <label className="text-xs space-y-1">
          <span className="font-semibold text-slate-600">Due date</span>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-8 bg-white" />
        </label>
        <label className="text-xs space-y-1">
          <span className="font-semibold text-slate-600">Delegated to</span>
          <Input value={delegatedTo} onChange={(e) => setDelegatedTo(e.target.value)} className="h-8 bg-white" />
        </label>
        <label className="text-xs space-y-1">
          <span className="font-semibold text-slate-600">Waiting on</span>
          <Input value={waitingOn} onChange={(e) => setWaitingOn(e.target.value)} className="h-8 bg-white" />
        </label>
        <label className="text-xs space-y-1 md:col-span-2">
          <span className="font-semibold text-slate-600">Notes</span>
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
          Save details
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
    onSuccess: () => { invalidate(); toast.success("Decision added to the inbox"); },
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
          <span className="font-bold text-[#1e2b58]">{open.length}</span> decisions waiting on your judgement.
          ATLAS only records what you decide — it never executes anything on its own.
        </p>
        <Button size="sm" className="bg-[#1e2b58]" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ New decision"}
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
          <Input value={f.title} placeholder="What needs deciding?" onChange={(e) => setD("title", e.target.value)} />
          <textarea value={f.context} placeholder="Context — what happened, figures, why it matters"
            onChange={(e) => setD("context", e.target.value)} rows={2}
            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
          <textarea value={f.optionsText} placeholder={"Options, one per line. Format: option | impact\nE.g.: Raise rate to $95 | +$18k/yr, risk of losing 1-2 small clients"}
            onChange={(e) => setD("optionsText", e.target.value)} rows={3}
            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm font-mono" />
          <Input value={f.recommendation} placeholder="Recommendation (optional)" onChange={(e) => setD("recommendation", e.target.value)} />
          <div className="flex gap-2">
            <label className="text-xs flex-1 space-y-1">
              <span className="font-semibold text-slate-600">Due date</span>
              <Input type="date" value={f.dueDate} onChange={(e) => setD("dueDate", e.target.value)} className="h-8" />
            </label>
            <label className="text-xs flex-1 space-y-1">
              <span className="font-semibold text-slate-600">Owner after deciding</span>
              <Input value={f.ownerAfter} placeholder="Who executes it?" onChange={(e) => setD("ownerAfter", e.target.value)} className="h-8" />
            </label>
          </div>
          <div className="flex justify-end">
            <Button size="sm" className="bg-[#1e2b58]" disabled={!f.title.trim() || create.isPending} onClick={submit}>
              Save to the inbox
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
                {r.dueDate && <div className="text-[11px] text-slate-500">Decide before: <b>{r.dueDate}</b></div>}
              </div>
              <button className="text-slate-300 hover:text-red-500 text-sm" title="Delete"
                onClick={() => { if (confirm("Delete this decision?")) del.mutate({ id: r.id }); }}>✕</button>
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
                <b>Recommendation:</b> {r.recommendation}
              </p>
            )}
            {r.ownerAfter && <p className="text-[11px] text-slate-500">Once decided, executed by: <b>{r.ownerAfter}</b></p>}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input value={noteById[r.id] ?? ""} placeholder="Decision note (optional)"
                onChange={(e) => setNoteById((m) => ({ ...m, [r.id]: e.target.value }))} className="h-8 flex-1 min-w-[180px] text-xs" />
              <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => decide.mutate({ id: r.id, status: "approved", decisionNote: noteById[r.id] || null })}>Approve</Button>
              <Button size="sm" variant="destructive" className="h-8"
                onClick={() => decide.mutate({ id: r.id, status: "rejected", decisionNote: noteById[r.id] || null })}>Reject</Button>
              <Button size="sm" variant="outline" className="h-8"
                onClick={() => decide.mutate({ id: r.id, status: "postponed", decisionNote: noteById[r.id] || null })}>Postpone</Button>
            </div>
          </div>
        );
      })}
      {!q.isLoading && open.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
          Inbox empty — no pending decisions.
        </div>
      )}

      {decided.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-2 bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Decision history
          </div>
          <div className="divide-y divide-slate-100">
            {decided.map((r) => (
              <div key={r.id} className="px-4 py-2 text-sm flex items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                  r.status === "approved" ? "bg-emerald-100 text-emerald-700"
                    : r.status === "rejected" ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700")}>
                  {r.status === "approved" ? "Approved" : r.status === "rejected" ? "Rejected" : "Postponed"}
                </span>
                <span className="font-medium flex-1">{r.title}</span>
                {r.decisionNote && <span className="text-slate-500 text-xs truncate max-w-[280px]">{r.decisionNote}</span>}
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {r.decidedAt ? new Date(r.decidedAt).toLocaleDateString("en-CA") : ""}
                </span>
                <Button size="sm" variant="ghost" className="h-6 text-[11px] text-slate-400"
                  onClick={() => decide.mutate({ id: r.id, status: "open" })}>Reopen</Button>
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
      <div className="mt-1 text-[10px] text-slate-400">Source: {source}</div>
    </div>
  );
}
