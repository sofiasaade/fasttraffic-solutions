import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Redirect, Route, Switch } from "wouter";
import { Loader2 } from "lucide-react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useSession } from "./contexts/SessionContext";
import CoordinatorShell from "./components/CoordinatorShell";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import DispatchBoard from "./pages/DispatchBoard";
import OvertimeDashboard from "./pages/OvertimeDashboard";
import Payroll from "./pages/Payroll";
import Accounting from "./pages/Accounting";
import Clients from "./pages/Clients";
import TeamPins from "./pages/TeamPins";
import ChangeHistoryPage from "./pages/ChangeHistoryPage";
import AlertsPage from "./pages/AlertsPage";
import PermitMap from "./pages/PermitMap";
import Messages from "./pages/Messages";
import Atlas from "./pages/Atlas";
import SafetyReports from "./pages/SafetyReports";
import Scheduler from "./pages/Scheduler";
import WorkersCalendar from "./pages/WorkersCalendar";
import PendingJobs from "./pages/PendingJobs";
import ProjectDetail from "./pages/ProjectDetail";
import TechnicianApp from "./pages/TechnicianApp";

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function Router() {
  const { loading, isAuthenticated, isCoordinator } = useSession();

  if (loading) return <FullScreenLoader />;

  if (!isAuthenticated) {
    return (
      <Switch>
        {/* ATLAS has its own login — never funnel it through the PIN gate. */}
        <Route path="/atlas" component={Atlas} />
        <Route path="/404" component={NotFound} />
        <Route component={Login} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/atlas" component={Atlas} />
      <Route path="/app" component={TechnicianApp} />
      {/* Match ALL sub-paths (multi-segment, e.g. /app/job/:id). The previous
          `:rest*` param only matched a single segment. */}
      <Route path="/app/*" component={TechnicianApp} />

      {isCoordinator ? (
        <>
          <Route path="/">
            <Redirect to="/dashboard" />
          </Route>
          <Route path="/dashboard">
            <CoordinatorShell>
              <Dashboard />
            </CoordinatorShell>
          </Route>
          <Route path="/dispatch">
            <CoordinatorShell>
              <DispatchBoard />
            </CoordinatorShell>
          </Route>
          <Route path="/scheduler">
            <CoordinatorShell>
              <Scheduler />
            </CoordinatorShell>
          </Route>
          <Route path="/projects/:id">
            <CoordinatorShell>
              <ProjectDetail />
            </CoordinatorShell>
          </Route>
          <Route path="/workers">
            <CoordinatorShell>
              <WorkersCalendar />
            </CoordinatorShell>
          </Route>
          <Route path="/pending">
            <CoordinatorShell>
              <PendingJobs />
            </CoordinatorShell>
          </Route>
          <Route path="/map">
            <CoordinatorShell>
              <PermitMap />
            </CoordinatorShell>
          </Route>
          <Route path="/overtime">
            <CoordinatorShell>
              <OvertimeDashboard />
            </CoordinatorShell>
          </Route>
          <Route path="/payroll">
            <CoordinatorShell>
              <Payroll />
            </CoordinatorShell>
          </Route>
          <Route path="/accounting">
            <CoordinatorShell>
              <Accounting />
            </CoordinatorShell>
          </Route>
          <Route path="/clients">
            <CoordinatorShell>
              <Clients />
            </CoordinatorShell>
          </Route>
          <Route path="/team-pins">
            <CoordinatorShell>
              <TeamPins />
            </CoordinatorShell>
          </Route>
          <Route path="/messages">
            <CoordinatorShell>
              <Messages />
            </CoordinatorShell>
          </Route>
          <Route path="/safety">
            <CoordinatorShell>
              <SafetyReports />
            </CoordinatorShell>
          </Route>
          <Route path="/alerts">
            <CoordinatorShell>
              <AlertsPage />
            </CoordinatorShell>
          </Route>
          <Route path="/history">
            <CoordinatorShell>
              <ChangeHistoryPage />
            </CoordinatorShell>
          </Route>
        </>
      ) : (
        <Route path="/">
          <Redirect to="/app" />
        </Route>
      )}

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
