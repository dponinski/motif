import type { Config } from "tailwindcss";

// A brand color as its channels, so a class can take an opacity (`bg-accent/15`).
const ch = (name: string) => `rgb(var(--${name}-rgb) / <alpha-value>)`;

// The hairline (card outlines, dividers): ink at a low opacity, so it sits on every surface.
const soft = "rgb(var(--ink-rgb) / var(--line-soft-alpha))";

const config: Config = {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // The height of every bar along the top of the editor (the logo, the view bars, the panel headers), so their lines meet.
      height: { bar: "40px" },
      colors: {
        // Surface tokens — resolved via CSS variables for theme support
        surface: {
          base: ch("surface"),
          raised: ch("surface-raised-brand"),
          overlay: ch("surface-raised-brand"),
          subtle: ch("surface-sunken"),
          border: soft,
          "border-subtle": soft,
        },
        // The brand: cobalt is selection and info (what the app calls its accent), blaze is the one primary action of a view. The other
        // colors are for tags, dots and small marks, each with its soft tint and the ink that goes on it.
        accent: { DEFAULT: ch("cobalt"), hover: ch("cobalt"), muted: ch("cobalt-soft"), border: ch("cobalt") },
        blaze: { DEFAULT: ch("blaze"), soft: ch("blaze-soft") },
        cobalt: { DEFAULT: ch("cobalt"), soft: ch("cobalt-soft") },
        sun: { DEFAULT: ch("sun"), soft: ch("sun-soft") },
        mint: { DEFAULT: ch("mint"), soft: ch("mint-soft") },
        bubblegum: { DEFAULT: ch("bubblegum"), soft: ch("bubblegum-soft") },
        "on-blaze": ch("on-blaze"),
        "on-cobalt": ch("on-cobalt"),
        "on-sun": ch("on-sun"),
        "on-mint": ch("on-mint"),
        "on-bubblegum": ch("on-bubblegum"),
        ink: { DEFAULT: ch("ink"), muted: ch("ink-muted") },
        line: { DEFAULT: ch("line"), soft },
        link: ch("link"),
        success: ch("success"),
        danger: ch("danger"),
        // Text tokens — resolved via CSS variables for theme support
        text: {
          primary: ch("ink"),
          secondary: ch("ink-muted"),
          tertiary: ch("ink-muted"),
          inverse: ch("surface"),
        },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', '"Bricolage Grotesque"', '"Arial Rounded MT Bold"', "system-ui", "sans-serif"],
        sans: ['"Figtree Variable"', "Figtree", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        mono: ['"DM Mono"', "ui-monospace", '"SF Mono"', "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", "14px"],
        xs: ["11px", "16px"],
        sm: ["12px", "18px"],
        base: ["13px", "20px"],
        md: ["14px", "20px"],
        lg: ["16px", "24px"],
      },
      spacing: {
        px: "1px",
        0.5: "2px",
        1: "4px",
        1.5: "6px",
        2: "8px",
        2.5: "10px",
        3: "12px",
        4: "16px",
        5: "20px",
        6: "24px",
        8: "32px",
        10: "40px",
        12: "48px",
      },
      // The brand's radii: 6 for tags and chips, 10 for buttons and inputs, 16 for cards and panels; pills are `rounded-full`.
      borderRadius: {
        sm: "6px",
        DEFAULT: "10px",
        md: "10px",
        lg: "16px",
        xl: "16px",
      },
      // Flat: cards and buttons have no shadow; only what floats above the page has one.
      boxShadow: {
        none: "none",
        sm: "none",
        DEFAULT: "none",
        md: "var(--shadow-card)",
        lg: "var(--shadow-card)",
        xl: "var(--shadow-raised)",
        "2xl": "var(--shadow-raised)",
      },
    },
  },
  plugins: [],
};

export default config;
