import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-xl border border-input bg-card px-3 py-2 text-base shadow-xs transition-[border-color,box-shadow,background-color] duration-200 ease-out outline-none placeholder:text-muted-foreground hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
