import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import {
  Cone,
  Users,
  Smartphone,
  ShieldCheck,
  Clock,
  ArrowRight,
} from "lucide-react";

export default function Login() {
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
          <div className="size-12 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
            <Cone className="size-7 text-primary-foreground" />
          </div>
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
            Welcome back
          </div>
          <h2 className="text-2xl font-bold mb-1">Sign in to continue</h2>
          <p className="text-muted-foreground text-sm mb-8">
            Coordinators land on the dispatch board. Technicians get their
            mobile job list.
          </p>

          <Button
            size="lg"
            className="w-full group"
            onClick={() => (window.location.href = getLoginUrl())}
          >
            Continue with Manus
            <ArrowRight className="size-4 ml-1 transition-transform group-hover:translate-x-0.5" />
          </Button>

          <p className="text-xs text-muted-foreground mt-6 leading-relaxed">
            Your role is detected automatically. On first sign-in, technicians
            pick their name from the roster to link their account.
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
