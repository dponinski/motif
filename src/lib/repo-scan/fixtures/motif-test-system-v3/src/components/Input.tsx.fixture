import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

const fieldBase =
  "w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs " +
  "placeholder:text-muted-foreground transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-invalid:border-danger aria-invalid:focus-visible:ring-danger";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, "h-10", className)}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, "py-2 min-h-20", className)}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
