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

// The brand pattern: the four logo shapes tiled on a 64px grid with an 8px gap, as one tidy band (a cover or an empty state), in at most five colors.
// One band to a page; never scattered.
const TILES: { shape: "circle" | "square" | "quarter" | "leaf"; fill: string }[][] = [
  [{ shape: "circle", fill: "var(--blaze)" }, { shape: "square", fill: "var(--cobalt)" }, { shape: "quarter", fill: "var(--sun)" }, { shape: "leaf", fill: "var(--mint)" }, { shape: "circle", fill: "var(--ink)" }, { shape: "square", fill: "var(--blaze)" }],
  [{ shape: "leaf", fill: "var(--cobalt)" }, { shape: "quarter", fill: "var(--blaze)" }, { shape: "circle", fill: "var(--mint)" }, { shape: "square", fill: "var(--ink)" }, { shape: "quarter", fill: "var(--cobalt)" }, { shape: "leaf", fill: "var(--sun)" }],
];

export function Pattern({ className }: { className?: string }) {
  const size = 64;
  const gap = 8;
  const cols = TILES[0].length;
  const width = cols * size + (cols - 1) * gap;
  const height = TILES.length * size + (TILES.length - 1) * gap;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation" aria-hidden="true" className={className} data-motif-pattern>
      {TILES.flatMap((row, r) => row.map((t, c) => {
        const x = c * (size + gap);
        const y = r * (size + gap);
        const half = size / 2;
        const shape = {
          circle: <circle cx={x + half} cy={y + half} r={half} fill={t.fill} />,
          square: <rect x={x} y={y} width={size} height={size} rx={10} fill={t.fill} />,
          quarter: <path d={`M${x} ${y + size} L${x + size} ${y + size} A${size} ${size} 0 0 0 ${x} ${y} Z`} fill={t.fill} />,
          leaf: <path d={`M${x} ${y} H${x + half} A${half} ${half} 0 0 1 ${x + size} ${y + half} V${y + size} H${x + half} A${half} ${half} 0 0 1 ${x} ${y + half} Z`} fill={t.fill} />,
        }[t.shape];
        return <g key={`${r}-${c}`}>{shape}</g>;
      }))}
    </svg>
  );
}
