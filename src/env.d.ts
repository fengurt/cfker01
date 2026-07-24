interface __BaseEnv_Env {
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  TENCENT_SECRET_ID?: string;
  TENCENT_SECRET_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_ADMIN_KEY?: string;
  MINIMAX_API_KEY?: string;
  API_KEY_SALT?: string;
  DEPLOY_VERSION?: string;
  COOKIE_SECURE?: string;
  CONTENT_ENCRYPTION_KEY?: string;
  CONTENT_KEY_VERSION?: string;
  PERPLEXITY_API_KEY?: string;
  X_BEARER_TOKEN?: string;
  GITHUB_TOKEN?: string;
  SEMANTIC_SCHOLAR_API_KEY?: string;
  INTERNAL_MONITOR_TOKEN?: string;
  LOCAL_SCAN_ROOT?: string;
  TEST_MIGRATIONS?: D1Migration[];
}

interface Env extends __BaseEnv_Env {}

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
