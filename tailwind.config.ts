import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        "primary-bg": "#E6E9E6",
        "brand-accent": "#8BD843",
        "brand-dark": "#000000",
        "brand-hover": "#619930",
      },
    },
  },
  plugins: [],
};

export default config;
