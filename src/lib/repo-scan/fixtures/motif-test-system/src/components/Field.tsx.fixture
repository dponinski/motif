import { cloneElement, isValidElement, useId, type LabelHTMLAttributes, type ReactElement } from "react";
import { cn } from "../lib/cn";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium leading-none", className)} {...props} />;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  /** A single form control (Input, Textarea, Select). It receives id, aria-describedby and invalid. */
  children: ReactElement<Record<string, unknown>>;
}

/** Wires a label, hint and error message to a form control accessibly. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        required,
        invalid: Boolean(error),
        "aria-describedby": message ? messageId : undefined,
      })
    : children;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </Label>
      {control}
      {message && (
        <p id={messageId} className={cn("text-xs", error ? "text-danger" : "text-muted-foreground")}>
          {message}
        </p>
      )}
    </div>
  );
}
