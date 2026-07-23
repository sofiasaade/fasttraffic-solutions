import { Route, Switch } from "wouter";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/contexts/SessionContext";
import TechShell from "@/components/TechShell";
import ClaimIdentity from "./tech/ClaimIdentity";
import TechRoster from "./tech/TechRoster";
import MyJobs from "./tech/MyJobs";
import MyHours from "./tech/MyHours";
import JobDetail from "./tech/JobDetail";
import Notifications from "./tech/Notifications";

export default function TechnicianApp() {
  const { isCoordinator } = useSession();
  const meQuery = trpc.technician.me.useQuery();

  if (meQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // A coordinator opening the tech app ALWAYS picks an employee first, then
  // browses that person's app (jobs, hours, day session) exactly as they see
  // it. Selecting a name switches the session to that technician.
  if (isCoordinator) {
    return <TechRoster />;
  }

  // First-time login: technician must self-identify.
  if (!meQuery.data) {
    return <ClaimIdentity />;
  }

  return (
    <TechShell>
      <Switch>
        <Route path="/app" component={MyJobs} />
        <Route path="/app/hours" component={MyHours} />
        <Route path="/app/notifications" component={Notifications} />
        <Route path="/app/job/:id" component={JobDetail} />
      </Switch>
    </TechShell>
  );
}
