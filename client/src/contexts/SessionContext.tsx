import { createContext, useContext, ReactNode } from "react";
import { trpc } from "@/lib/trpc";

export interface TechnicianProfile {
  id: number;
  airtableName: string;
  displayName: string;
  userId: number | null;
  phone: string | null;
  zones: string | null;
  active: boolean;
}

interface SessionValue {
  loading: boolean;
  isAuthenticated: boolean;
  user: { id: number; name: string | null; email: string | null; role: string } | null;
  isCoordinator: boolean;
  technician: TechnicianProfile | null;
  refetch: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const isAuthenticated = Boolean(meQuery.data);

  const profileQuery = trpc.auth.profile.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const value: SessionValue = {
    loading: meQuery.isLoading || (isAuthenticated && profileQuery.isLoading),
    isAuthenticated,
    user: (profileQuery.data?.user as any) ?? (meQuery.data as any) ?? null,
    isCoordinator: profileQuery.data?.isCoordinator ?? false,
    technician: (profileQuery.data?.technician as TechnicianProfile | null) ?? null,
    refetch: () => {
      meQuery.refetch();
      profileQuery.refetch();
    },
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
