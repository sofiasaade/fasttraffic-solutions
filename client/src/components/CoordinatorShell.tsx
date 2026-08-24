import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Clock,
  History,
  LogOut,
  Smartphone,
  Map as MapIcon,
  CalendarRange,
  BellRing,
  MessageSquare,
  ShieldCheck,
  Gauge,
  Users,
  AlertTriangle,
  Wallet,
  Briefcase,
  Receipt,
  KeyRound,
} from "lucide-react";
import { useSession } from "@/contexts/SessionContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import GlobalProjectSearch from "@/components/GlobalProjectSearch";
import BrandMark from "@/components/BrandMark";

// Same destinations, same order — grouped visually like an enterprise console.
const NAV_GROUPS: {
  title: string;
  items: { href: string; label: string; icon: typeof Gauge }[];
}[] = [
  {
    title: "Operate",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Gauge },
      { href: "/scheduler", label: "Scheduler", icon: CalendarRange },
      { href: "/messages", label: "Messages", icon: MessageSquare },
      { href: "/workers", label: "Workers", icon: Users },
      { href: "/dispatch", label: "Dispatch Board", icon: LayoutDashboard },
    ],
  },
  {
    title: "Monitor",
    items: [
      { href: "/pending", label: "Pending Jobs", icon: AlertTriangle },
      { href: "/clients", label: "Clients", icon: Briefcase },
      { href: "/map", label: "Permit Map", icon: MapIcon },
      { href: "/safety", label: "Safety", icon: ShieldCheck },
      { href: "/alerts", label: "Change Alerts", icon: BellRing },
    ],
  },
  {
    title: "Records",
    items: [
      { href: "/overtime", label: "Overtime", icon: Clock },
      { href: "/payroll", label: "Payroll", icon: Wallet },
      { href: "/accounting", label: "Accounting", icon: Receipt },
      { href: "/team-pins", label: "Team PINs", icon: KeyRound },
      { href: "/history", label: "Change History", icon: History },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((g) => g.items);

function initials(name: string | null | undefined): string {
  if (!name) return "C";
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function CoordinatorShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useSession();
  const { logout } = useAuth();
  const badges = trpc.coordinator.changeBadges.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const alertCount = badges.data
    ? Object.values(badges.data).reduce((n, arr) => n + (arr?.length ?? 0), 0)
    : 0;
  const pending = trpc.coordinator.pendingJobs.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const pendingCount = pending.data?.count ?? 0;
  const msgs = trpc.coordinator.messagesBadge.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const msgCount = msgs.data?.unread ?? 0;

  const current = NAV.find(
    (i) => location === i.href || location.startsWith(i.href + "/"),
  );
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const badgeFor = (href: string) => {
    if (href === "/alerts" && alertCount > 0)
      return { n: alertCount, cls: "bg-red-500" };
    if (href === "/pending" && pendingCount > 0)
      return { n: pendingCount, cls: "bg-rose-500" };
    if (href === "/messages" && msgCount > 0)
      return { n: msgCount, cls: "bg-blue-500" };
    return null;
  };

  return (
    <div className="min-h-screen flex bg-transparent">
      <aside
        className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shadow-[4px_0_24px_-12px_rgba(15,23,42,0.35)]"
        style={{
          backgroundImage:
            "linear-gradient(180deg, oklch(0.38 0.125 272) 0%, oklch(0.35 0.12 272) 34%, oklch(0.3 0.11 273) 100%)",
        }}
      >
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-sidebar-border">
          <BrandMark className="size-9" />
          <div className="leading-tight">
            <div className="font-extrabold tracking-tight">Fast Traffic</div>
            <div className="text-[11px] uppercase tracking-widest text-sidebar-foreground/60">
              Operations OS
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-3 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mb-4">
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40 select-none">
                {group.title}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    location === item.href || location.startsWith(item.href + "/");
                  const Icon = item.icon;
                  const badge = badgeFor(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "relative flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-primary" />
                      )}
                      <Icon
                        className={cn(
                          "size-4.5 shrink-0",
                          active ? "text-primary" : "text-sidebar-foreground/50",
                        )}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {badge && (
                        <span
                          className={cn(
                            "inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-white text-[10px] font-bold",
                            badge.cls,
                          )}
                        >
                          {badge.n > 99 ? "99+" : badge.n}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="pt-1 mt-1 border-t border-sidebar-border/60">
            <Link
              href="/app"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors mt-2"
            >
              <Smartphone className="size-4.5 text-sidebar-foreground/50" />
              Technician App
            </Link>
          </div>
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="flex items-center justify-center size-8 rounded-full bg-sidebar-accent text-[11px] font-bold shrink-0">
              {initials(user?.name)}
            </div>
            <div className="min-w-0 text-sm leading-tight">
              <div className="font-medium truncate">{user?.name ?? "Coordinator"}</div>
              <div className="text-[11px] text-sidebar-foreground/50 truncate">
                {user?.email}
              </div>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-[13px] font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 transition-colors"
          >
            <LogOut className="size-4.5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main area with a persistent top bar holding the global project search */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop top bar: page context + global project search on every window */}
        <header className="hidden md:flex items-center gap-4 h-16 px-6 border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-40">
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold leading-tight truncate">
              {current?.label ?? "Fast Traffic OS"}
            </h1>
            <div className="text-[11px] text-muted-foreground">{today}</div>
          </div>
          <GlobalProjectSearch className="w-full max-w-md ml-auto" />
          <Link
            href="/alerts"
            className="relative flex items-center justify-center size-9 rounded-lg border border-border bg-card hover:bg-accent transition-colors shrink-0"
            aria-label="Change alerts"
          >
            <BellRing className="size-4 text-muted-foreground" />
            {alertCount > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold">
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
          </Link>
        </header>
        <header className="md:hidden flex items-center justify-between h-14 px-4 bg-sidebar text-sidebar-foreground">
          <div className="flex items-center gap-2 font-bold">
            <BrandMark className="size-7" iconClassName="size-4" />
            Fast Traffic
          </div>
          <button onClick={() => logout()}>
            <LogOut className="size-5" />
          </button>
        </header>
        {/* Mobile global project search bar */}
        <div className="md:hidden px-3 py-2 border-b border-border bg-card">
          <GlobalProjectSearch />
        </div>
        <nav className="md:hidden flex border-b border-border bg-card overflow-x-auto">
          {NAV.map((item) => {
            const active = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-4 py-3 text-sm font-medium whitespace-nowrap",
                  active
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
