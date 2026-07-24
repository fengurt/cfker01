import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || "https://catalog.example.com",
  output: "static",
  integrations: [sitemap({ filter: (page) => !page.includes("/system-admin/") })],
  build: { format: "directory" },
});
