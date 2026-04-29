/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bank: {
          50: "rgb(var(--bank-50) / <alpha-value>)",
          100: "rgb(var(--bank-100) / <alpha-value>)",
          600: "rgb(var(--bank-600) / <alpha-value>)",
          700: "rgb(var(--bank-700) / <alpha-value>)",
          900: "rgb(var(--bank-900) / <alpha-value>)"
        }
      },
      fontFamily: {
        sans: ["Tajawal", "Cairo", "Segoe UI", "Tahoma", "Arial", "sans-serif"]
      }
    }
  },
  plugins: []
};
