import type { Unit } from "./model";

// What a Number or a String can say it is for (the repository's naming for it comes later: for now it is how Motif arranges them).
export const NUMBER_USES: { value: string; label: string }[] = [
  { value: "", label: "Not said" },
  { value: "font-size", label: "Font size" },
  { value: "line-height", label: "Line height" },
  { value: "font-weight", label: "Font weight" },
  { value: "letter-spacing", label: "Letter spacing" },
];

export const STRING_USES: { value: string; label: string }[] = [
  { value: "", label: "Not said" },
  { value: "font-family", label: "Font family" },
];

export const UNITS: { value: Unit; label: string }[] = [
  { value: "px", label: "px" },
  { value: "rem", label: "rem" },
  { value: "em", label: "em" },
  { value: "%", label: "%" },
  { value: "", label: "none" },
];

export const isUnit = (v: string): v is Unit => UNITS.some((u) => u.value === v);
