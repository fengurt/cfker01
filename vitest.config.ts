import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => ({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            ADMIN_TOKEN: "test-admin-token-not-for-production",
            API_KEY_SALT: "test-api-key-salt-at-least-32-characters",
            CONTENT_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
            CONTENT_KEY_VERSION: "test-v1",
            INTERNAL_MONITOR_TOKEN: "test-monitor-token-not-for-production",
            LOCAL_SCAN_ROOT: "/Users/af/cpro01",
            TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          },
        },
      },
    },
  },
}));
