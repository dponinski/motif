// The Motif mark (a blaze circle, a cobalt square, a sun quarter and a mint leaf) and the wordmark, which is always lowercase.

export function Mark({ size = 24, ink = false, className }: { size?: number; ink?: boolean; className?: string }) {
  const [a, b, c, d] = ink ? Array(4).fill("var(--ink)") : ["var(--blaze)", "var(--cobalt)", "var(--sun)", "var(--mint)"];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className={className} data-motif-mark>
      <circle cx="23" cy="23" r="23" fill={a} />
      <rect x="54" width="46" height="46" rx="10" fill={b} />
      <path d="M46 54 L0 54 A46 46 0 0 0 46 100 Z" fill={c} />
      <path d="M54 54 H77 A23 23 0 0 1 100 77 V100 H77 A23 23 0 0 1 54 77 Z" fill={d} />
    </svg>
  );
}

export default function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`} data-logo>
      <Mark size={size} />
      <span className="font-display font-bold leading-none tracking-[-0.025em] text-ink" style={{ fontSize: Math.round(size * 0.8) }}>motif</span>
    </span>
  );
}
