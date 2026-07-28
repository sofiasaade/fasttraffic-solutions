import { useState } from "react";
import { Button } from "@/components/ui/button";
import BrandMark from "@/components/BrandMark";
import { toast } from "sonner";
import {
  Users,
  Smartphone,
  ShieldCheck,
  Clock,
  Loader2,
  HardHat,
  UserCog,
} from "lucide-react";

export default function Login() {
  const [role, setRole] = useState<"coordinator" | "tech">("coordinator");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!/^\d{4,8}$/.test(pin)) {
      toast.error("Enter your PIN.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/pin-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: role === "tech" ? "tech" : "coordinator", pin }),
      });
      const data = await r.json();
      if (data.ok) {
        window.location.href = data.redirect;
      } else {
        toast.error(data.error ?? "Wrong PIN.");
        setBusy(false);
      }
    } catch {
      toast.error("Sign-in failed.");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-sidebar text-sidebar-foreground grid lg:grid-cols-[1.1fr_1fr]">
      {/* Left: brand + value prop */}
      <div className="relative flex flex-col justify-between p-8 lg:p-14 overflow-hidden">
        {/* texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, #e8782e 0, #e8782e 18px, transparent 18px, transparent 36px)",
          }}
        />
        <div className="absolute -top-24 -right-24 size-72 rounded-full bg-primary/20 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <BrandMark
            className="size-12 rounded-xl shadow-lg shadow-primary/30"
            iconClassName="size-6"
          />
          <div>
            <div className="text-xl font-extrabold tracking-tight">
              Fast Traffic OS
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/60">
              Dispatch & Field Operations
            </div>
          </div>
        </div>

        <div className="relative z-10 max-w-xl my-10">
          <h1 className="text-4xl lg:text-5xl font-extrabold leading-[1.05] mb-5">
            Run your traffic-control
            <span className="text-primary"> operation</span> from one place.
          </h1>
          <p className="text-sidebar-foreground/70 text-lg leading-relaxed">
            Dispatch confirmed jobs, assign technicians by phase, track hours
            against the Alberta 44-hour threshold, and gate every check-in
            behind a hazard assessment — with job data sourced live from Airtable.
          </p>
        </div>

        <div className="relative z-10 grid sm:grid-cols-2 gap-3 max-w-xl">
          <Feature icon={Users} text="Dispatch board with conflict detection" />
          <Feature icon={Smartphone} text="Technician mobile app (PWA)" />
          <Feature icon={ShieldCheck} text="Hazard gate before check-in" />
          <Feature icon={Clock} text="Overtime monitoring (44h)" />
        </div>
      </div>

      {/* Right: sign-in card */}
      <div className="flex items-center justify-center p-8 bg-background text-foreground">
        <div className="w-full max-w-sm">
          <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Sign in
          </div>
          <h2 className="text-2xl font-bold mb-4">Enter your PIN</h2>

          {/* Role toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-xl mb-4">
            <button
              onClick={() => setRole("coordinator")}
              className={
                "flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors " +
                (role === "coordinator"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground")
              }
            >
              <UserCog className="size-4" /> Coordinator
            </button>
            <button
              onClick={() => setRole("tech")}
              className={
                "flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors " +
                (role === "tech"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground")
              }
            >
              <HardHat className="size-4" /> Technician
            </button>
          </div>

          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="••••"
            className="w-full h-14 text-center text-2xl tracking-[0.4em] font-bold rounded-xl border border-border bg-background mb-4"
          />

          <Button size="lg" className="w-full" disabled={busy} onClick={submit}>
            {busy && <Loader2 className="size-4 animate-spin mr-1" />}
            {role === "coordinator" ? "Enter console" : "Open my jobs"}
          </Button>

          <p className="text-xs text-muted-foreground mt-6 leading-relaxed">
            {role === "coordinator"
              ? "Coordinator PIN opens the full console."
              : "Your personal PIN opens only your jobs — ask your coordinator for it."}
          </p>
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <div className="flex items-center gap-3 text-sidebar-foreground/80 text-sm">
      <div className="size-9 rounded-lg bg-sidebar-accent flex items-center justify-center shrink-0">
        <Icon className="size-4 text-primary" />
      </div>
      {text}
    </div>
  );
}
