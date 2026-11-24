/** @type {import('tailwindcss').Config} */
// Brand / accent / ink are CSS variables (see app/globals.css), set per
// site style (data-style on <html>) and per light/dark mode. Wiring the
// Tailwind scales to the variables makes every existing brand-*/accent-*/
// ink-* class follow the active style automatically.
const withAlpha = (name) => ({ opacityValue }) =>
  opacityValue === undefined
    ? `rgb(var(--${name}))`
    : `rgb(var(--${name}) / ${opacityValue})`;

const scale = (prefix, stops) =>
  Object.fromEntries(stops.map((s) => [s, withAlpha(`${prefix}-${s}`)]));

module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: scale("brand", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        accent: scale("accent", [50, 100, 200, 300, 400, 500, 600, 700]),
        ink: scale("ink", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(23,21,43,0.05), 0 8px 24px -12px rgba(23,21,43,0.14)",
        lift: "0 2px 4px rgba(23,21,43,0.06), 0 16px 40px -16px rgba(23,21,43,0.22)",
        glow: "0 0 0 1px rgb(var(--brand-500) / 0.18), 0 12px 32px -8px rgb(var(--brand-600) / 0.45)",
        card: "0 1px 3px rgba(23,21,43,0.06), 0 10px 30px -18px rgba(23,21,43,0.25)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pop: {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        pop: "pop 0.25s cubic-bezier(0.22, 1, 0.36, 1) both",
        float: "float 5s ease-in-out infinite",
        shimmer:
          "shimmer 1.8s linear infinite",
      },
    },
  },
  plugins: [],
};
