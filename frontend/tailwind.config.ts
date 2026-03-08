import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Neutral palette — monochrome
        neutral: {
          50:  "#fafafa",
          100: "#f5f5f5",
          200: "#e5e5e5",
          300: "#d4d4d4",
          400: "#a3a3a3",
          500: "#737373",
          600: "#525252",
          700: "#404040",
          800: "#262626",
          900: "#171717",
          950: "#0a0a0a",
        },
        // Status colors (muted)
        emerald: { 400: "#4ade80", 500: "#22c55e" },
        amber:   { 400: "#facc15", 500: "#eab308" },
        rose:    { 400: "#f87171", 500: "#ef4444" },
        sky:     { 400: "#60a5fa", 500: "#3b82f6" },
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "Cascadia Code",
          "Source Code Pro",
          "Menlo",
          "Consolas",
          "DejaVu Sans Mono",
          "monospace",
        ],
        sans: [
          "ui-monospace",
          "Cascadia Code",
          "Source Code Pro",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        none: "0",
        sm:   "0.125rem",
        DEFAULT: "0.125rem",
        md:   "0.25rem",
        lg:   "0.25rem",
        xl:   "0.375rem",
        "2xl": "0.5rem",
        full: "9999px",
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "1rem" }],
        xs:   ["0.6875rem", { lineHeight: "1.125rem" }],
        sm:   ["0.8125rem", { lineHeight: "1.375rem" }],
        base: ["0.875rem",  { lineHeight: "1.5rem" }],
        lg:   ["1rem",      { lineHeight: "1.625rem" }],
        xl:   ["1.125rem",  { lineHeight: "1.75rem" }],
        "2xl":["1.375rem",  { lineHeight: "2rem" }],
        "3xl":["1.75rem",   { lineHeight: "2.25rem" }],
        "4xl":["2.25rem",   { lineHeight: "2.75rem" }],
        "5xl":["3rem",      { lineHeight: "3.5rem" }],
        "6xl":["3.75rem",   { lineHeight: "4.25rem" }],
        "7xl":["4.5rem",    { lineHeight: "5rem" }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
        "fade-up": {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0" },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.6" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "accordion-down":  "accordion-down 0.2s ease-out",
        "accordion-up":    "accordion-up 0.2s ease-out",
        "fade-up":         "fade-up 0.35s ease forwards",
        blink:             "blink 1s step-end infinite",
        "pulse-subtle":    "pulse-subtle 2s ease-in-out infinite",
        shimmer:           "shimmer 2s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
