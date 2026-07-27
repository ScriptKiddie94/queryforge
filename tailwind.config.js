/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Ported from the sigma-to-kql design system so the two apps read as a suite.
        bg: "#0d1117",
        panel: "#161b22",
        "panel-2": "#1c2230",
        border: "#30363d",
        text: "#e6edf3",
        muted: "#8b949e",
        accent: "#58a6ff",
        code: "#c9d1d9",
        sentinel: "#58a6ff",
        defender: "#a371f7",
        splunk: "#7ee787",
      },
      fontFamily: {
        mono: ['"SF Mono"', "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
