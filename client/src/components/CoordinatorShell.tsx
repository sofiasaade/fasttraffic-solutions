import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Clock,
  History,
  Cone,
  LogOut,
  Smartphone,
  Map as MapIcon,
  CalendarRange,
} from "lucide-react";
import { useSession } from "@/contexts/SessionContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dispatch", label: "Dispatch Board", icon: LayoutDashboard },
  { href: "/scheduler", label: "Scheduler", icon: CalendarRange },
  { href: "/map", label: "Permit Map", icon: MapIcon },
  { href: "/overtime", label: "Overtime", icon: Clock },
  { href: "/history", label: "Change History", icon: History },
];

export default function CoordinatorShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useSession();
  const { logout } = useAuth();

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-sidebar-border">
          <div className="size-9 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Cone className="size-5 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <div className="font-extrabold tracking-tight">Fast Traffic</div>
            <div className="text-[11px] uppercase tracking-widest text-sidebar-foreground/60">
              Operations OS
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item) => {
            const active = location === item.href || location.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4.5" />
                {item.label}
              </Link>
            );
          })}

          <Link
            href="/app"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors mt-4"
          >
            <Smartphone className="size-4.5" />
            Technician App
          </Link>
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <div className="px-3 py-2 text-sm">
            <div className="font-medium truncate">{user?.name ?? "Coordinator"}</div>
            <div className="text-xs text-sidebar-foreground/50 truncate">
              {user?.email}
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/60 transition-colors"
          >
            <LogOut className="size-4.5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar for coordinator */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between h-14 px-4 bg-sidebar text-sidebar-foreground">
          <div className="flex items-center gap-2 font-bold">
            <Cone className="size-5 text-primary" /> Fast Traffic
          </div>
          <button onClick={() => logout()}>
            <LogOut className="size-5" />
          </button>
        </header>
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
