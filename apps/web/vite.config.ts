import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves project sites under /<repo>/. Set base so asset URLs resolve.
// Override with VITE_BASE for a custom domain (set it to "/").
export default defineConfig({
  base: process.env.VITE_BASE ?? "/second-brain-varun-patkar/",
  plugins: [react()],
});
