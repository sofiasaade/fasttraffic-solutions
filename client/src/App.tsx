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
import DispatchBoard from "./pages/DispatchBoard";
import OvertimeDashboard from "./pages/OvertimeDashboard";
import ChangeHistoryPage from "./pages/ChangeHistoryPage";
import PermitMap from "./pages/PermitMap";
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
        <Route path="/404" component={NotFound} />
        <Route component={Login} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/app" component={TechnicianApp} />
      <Route path="/app/:rest*" component={TechnicianApp} />

      {isCoordinator ? (
        <>
          <Route path="/">
            <Redirect to="/dispatch" />
          </Route>
          <Route path="/dispatch">
            <CoordinatorShell>
              <DispatchBoard />
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
