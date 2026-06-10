import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Cone, ClipboardList, Bell, LogOut } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";

export default function TechShell({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  const [location] = useLocation();
  const { logout } = useAuth();
  const notifQuery = trpc.technician.notifications.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const unread = notifQuery.data?.unread ?? 0;

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-md mx-auto relative">
      <header className="sticky top-0 z-20 bg-sidebar text-sidebar-foreground">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-primary flex items-center justify-center">
              <Cone className="size-4.5 text-primary-foreground" />
            </div>
            <span className="font-bold">{title ?? "Fast Traffic"}</span>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/app/notifications"
              className="relative p-2 rounded-lg hover:bg-sidebar-accent"
            >
              <Bell className="size-5" />
              {unread > 0 && (
                <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
            <button
              onClick={() => logout()}
              className="p-2 rounded-lg hover:bg-sidebar-accent"
            >
              <LogOut className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-20">{children}</main>

      <nav className="fixed bottom-0 inset-x-0 max-w-md mx-auto bg-card border-t border-border z-20">
        <div className="grid grid-cols-2">
          <TabLink
            href="/app"
            active={location === "/app"}
            icon={ClipboardList}
            label="My Jobs"
          />
          <TabLink
            href="/app/notifications"
            active={location === "/app/notifications"}
            icon={Bell}
            label="Alerts"
            badge={unread}
          />
        </div>
      </nav>
    </div>
  );
}

function TabLink({
  href,
  active,
  icon: Icon,
  label,
  badge,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium relative",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <div className="relative">
        <Icon className="size-5" />
        {badge ? (
          <span className="absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </div>
      {label}
    </Link>
  );
}
