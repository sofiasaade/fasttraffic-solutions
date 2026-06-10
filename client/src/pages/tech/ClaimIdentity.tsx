import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Loader2, Cone, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSession } from "@/contexts/SessionContext";

export default function ClaimIdentity() {
  const { refetch } = useSession();
  const rosterQuery = trpc.technician.roster.useQuery();
  const [selected, setSelected] = useState<string | null>(null);

  const claim = trpc.technician.claimIdentity.useMutation({
    onSuccess: () => {
      toast.success("Identity confirmed");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-sidebar text-sidebar-foreground flex flex-col max-w-md mx-auto">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="size-9 rounded-lg bg-primary flex items-center justify-center">
            <Cone className="size-5 text-primary-foreground" />
          </div>
          <span className="font-bold text-lg">Fast Traffic</span>
        </div>
        <h1 className="text-xl font-bold mb-1">Who are you?</h1>
        <p className="text-sm text-sidebar-foreground/70 mb-5">
          Select your name to link your account. You only do this once.
        </p>

        {rosterQuery.isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}

        <div className="space-y-2">
          {rosterQuery.data?.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t.airtableName)}
              className={cn(
                "flex items-center justify-between w-full px-4 py-3 rounded-xl border text-left transition-colors",
                selected === t.airtableName
                  ? "border-primary bg-primary/10"
                  : "border-sidebar-border hover:bg-sidebar-accent",
              )}
            >
              <span className="font-medium">{t.displayName}</span>
              {selected === t.airtableName && (
                <Check className="size-5 text-primary" />
              )}
            </button>
          ))}
        </div>

        <Button
          className="w-full mt-6"
          size="lg"
          disabled={!selected || claim.isPending}
          onClick={() => selected && claim.mutate({ airtableName: selected })}
        >
          {claim.isPending && <Loader2 className="size-4 animate-spin mr-1" />}
          Confirm
        </Button>
      </div>
    </div>
  );
}
