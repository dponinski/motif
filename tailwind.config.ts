import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surface tokens
        surface: {
          base: "#0a0a0a",
          raised: "#111111",
          overlay: "#181818",
          subtle: "#1f1f1f",
          border: "#282828",
          "border-subtle": "#1e1e1e",
        },
        // Accent tokens
        accent: {
          DEFAULT: "#6366f1",
          hover: "#818cf8",
          muted: "rgba(99,102,241,0.12)",
          border: "rgba(99,102,241,0.3)",
        },
        // Text tokens
        text: {
          primary: "#f0f0f0",
          secondary: "#888888",
          tertiary: "#555555",
          inverse: "#0a0a0a",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
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
      borderRadius: {
        sm: "3px",
        DEFAULT: "5px",
        md: "7px",
        lg: "10px",
        xl: "14px",
      },
      animation: {
        "fade-in": "fadeIn 0.15s ease-out",
        "slide-up": "slideUp 0.2s ease-out",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { transform: "translateY(8px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
