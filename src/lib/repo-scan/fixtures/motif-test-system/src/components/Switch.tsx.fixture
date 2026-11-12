import { useState } from "react";
import { cn } from "../lib/cn";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, defaultChecked = false, onCheckedChange, label, disabled, className }: SwitchProps) {
  const [internal, setInternal] = useState(defaultChecked);
  const isOn = checked ?? internal;

  const toggle = () => {
    if (checked === undefined) setInternal(!isOn);
    onCheckedChange?.(!isOn);
  };

  return (
    <label className={cn("inline-flex items-center gap-2 text-sm", disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        disabled={disabled}
        onClick={toggle}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          isOn ? "bg-primary" : "bg-muted border border-border",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 rounded-full bg-background shadow-card transition-transform",
            isOn ? "translate-x-5.5" : "translate-x-0.5",
          )}
        />
      </button>
      {label}
    </label>
  );
}
