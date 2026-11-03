import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.68rem] font-medium leading-4 whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-gold/30 bg-gold/10 text-gold-light",
        neutral: "border-border bg-surface-3 text-muted",
        success: "border-success/30 bg-success/10 text-success",
        info: "border-info/30 bg-info/10 text-info",
        warning: "border-warning/30 bg-warning/10 text-warning",
        danger: "border-danger/30 bg-danger/10 text-danger",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
