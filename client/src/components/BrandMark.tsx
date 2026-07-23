import { ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Self-contained FTS brand mark, matched to the company logo: orange
 * fast-forward chevrons (») on the logo's deep indigo-navy. Replaces the old
 * bitmap that was served from Manus storage — renders identically everywhere
 * with zero external dependencies.
 */
export default function BrandMark({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg shrink-0 shadow-sm ring-1 ring-white/15",
        className,
      )}
      style={{
        background:
          "linear-gradient(135deg, oklch(0.4 0.13 272) 0%, oklch(0.31 0.12 274) 100%)",
        color: "oklch(0.69 0.2 41)",
      }}
    >
      <ChevronsRight className={cn("size-5", iconClassName)} strokeWidth={3} />
    </div>
  );
}
