import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Camera, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Category = "before" | "during" | "after";
const CATEGORIES: Category[] = ["before", "during", "after"];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Downscale large photos client-side to keep payloads small.
async function compressImage(file: File, maxDim = 1600): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export default function PhotoUpload({ jobId }: { jobId: string }) {
  const utils = trpc.useUtils();
  const [category, setCategory] = useState<Category>("before");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = trpc.technician.uploadPhoto.useMutation({
    onSuccess: () => {
      toast.success("Photo uploaded");
      utils.technician.myJobs.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await compressImage(file);
      await upload.mutateAsync({
        jobId,
        category,
        dataBase64: dataUrl,
        mimeType: "image/jpeg",
      });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 p-1 bg-muted rounded-lg">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn(
              "flex-1 px-3 py-1.5 text-sm font-medium rounded-md capitalize transition-colors",
              category === c
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground",
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
      />
      <Button
        variant="outline"
        className="w-full"
        size="lg"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin mr-1" />
        ) : (
          <Camera className="size-4 mr-1" />
        )}
        Capture {category} photo
      </Button>
    </div>
  );
}
