import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/hooks/**/*.{js,ts,jsx,tsx}",
    "./src/lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Legacy shadcn tokens — still used by unredesigned pages.
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
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Topaz CRM design system tokens — see DESIGN_SYSTEM.md / tokens.css.
        acc: "var(--acc)",
        accS: "var(--accS)",
        accL: "var(--accL)",
        bg: "var(--bg)",
        rail: "var(--rail)",
        sf: "var(--sf)",
        sf2: "var(--sf2)",
        sf3: "var(--sf3)",
        ln: "var(--ln)",
        ln2: "var(--ln2)",
        t1: "var(--t1)",
        t2: "var(--t2)",
        t3: "var(--t3)",
        pos: "var(--pos)",
        posS: "var(--posS)",
        warn: "var(--warn)",
        warnS: "var(--warnS)",
      },
      // Overwrites the old radius scale (~1px delta) — intentional, see DESIGN_SYSTEM.md §3.
      borderRadius: {
        kbd: "4px",
        badge: "5px",
        sm: "7px",
        md: "8px",
        lg: "9px",
        card: "10px",
        pop: "11px",
        shell: "14px",
        pill: "99px",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "SF Pro Text", "-apple-system", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "label-sm": ["10px", { letterSpacing: ".08em", fontWeight: "600" }],
        label: ["10.5px", { letterSpacing: ".09em", fontWeight: "600" }],
        meta: ["11px", { fontWeight: "450" }],
        caption: ["12px", { fontWeight: "450" }],
        ui: ["12.5px", { fontWeight: "480" }],
        body: ["13px", { fontWeight: "450" }],
        nav: ["13.5px", { letterSpacing: "-.008em", fontWeight: "480" }],
        section: ["14px", { letterSpacing: "-.012em", fontWeight: "600" }],
        metric: ["18px", { fontWeight: "600" }],
        title: ["21px", { letterSpacing: "-.022em", fontWeight: "600" }],
      },
      fontWeight: { 450: "450", 480: "480", 560: "560" },
      boxShadow: { sh: "var(--sh)", shp: "var(--shp)" },
      height: { row: "var(--row)" },
      keyframes: {
        popIn: { from: { opacity: "0", transform: "translateY(6px) scale(.985)" }, to: { opacity: "1", transform: "none" } },
        slideIn: { from: { opacity: "0", transform: "translateX(-8px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        popIn: "popIn .13s ease-out",
        slideIn: "slideIn .16s cubic-bezier(.22,1,.36,1)",
      },
    },
  },
  plugins: [forms],
};

export default config;
