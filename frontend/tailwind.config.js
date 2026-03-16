/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0f1117",
          1: "#161b22",
          2: "#1c2128",
          3: "#22272e",
        },
        brand: {
          DEFAULT: "#58a6ff",
          dim: "#1f3a5f",
        },
        hit: "#3fb950",
        miss: "#f85149",
        evict: "#d29922",
        contend: "#bc8cff",
        stale: "#8b949e",
      },
    },
  },
  plugins: [],
};
