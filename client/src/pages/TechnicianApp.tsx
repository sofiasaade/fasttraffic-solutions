import { Route, Switch } from "wouter";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import TechShell from "@/components/TechShell";
import ClaimIdentity from "./tech/ClaimIdentity";
import MyJobs from "./tech/MyJobs";
import JobDetail from "./tech/JobDetail";
import Notifications from "./tech/Notifications";

export default function TechnicianApp() {
  const meQuery = trpc.technician.me.useQuery();

  if (meQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // First-time login: technician must self-identify.
  if (!meQuery.data) {
    return <ClaimIdentity />;
  }

  return (
    <TechShell>
      <Switch>
        <Route path="/app" component={MyJobs} />
        <Route path="/app/notifications" component={Notifications} />
        <Route path="/app/job/:id" component={JobDetail} />
      </Switch>
    </TechShell>
  );
}
