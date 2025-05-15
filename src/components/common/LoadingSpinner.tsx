import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  className?: string;
  size?: number;
  text?: string;
}

export function LoadingSpinner({ className, size = 32, text }: LoadingSpinnerProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2", className)}>
      <Loader2
        className="animate-spin text-primary"
        size={size}
        aria-label="Loading..."
      />
      {text && <p className="text-sm text-muted-foreground">{text}</p>}
    </div>
  );
}
