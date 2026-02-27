/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'terminal-bg': '#1E1E1E',
        'sidebar-bg': '#252526',
        'sidebar-active': '#37373D',
        'border-color': '#3C3C3C',
      }
    },
  },
  plugins: [],
}
