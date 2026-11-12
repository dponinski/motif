import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const alertVariants = cva("flex gap-3 rounded-lg border p-4 text-sm", {
  variants: {
    variant: {
      info: "border-primary/30 bg-primary/8",
      success: "border-success/30 bg-success/8",
      warning: "border-warning/40 bg-warning/10",
      danger: "border-danger/30 bg-danger/8",
    },
  },
  defaultVariants: { variant: "info" },
});

const accent = {
  info: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title">, VariantProps<typeof alertVariants> {
  title?: ReactNode;
}

export function Alert({ className, variant, title, children, ...props }: AlertProps) {
  const v = variant ?? "info";
  return (
    <div
      role={v === "danger" || v === "warning" ? "alert" : "status"}
      className={cn(alertVariants({ variant: v }), className)}
      {...props}
    >
      <span aria-hidden className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", accent[v])} />
      <div className="flex flex-col gap-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}
