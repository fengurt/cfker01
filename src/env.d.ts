interface __BaseEnv_Env {
  ADMIN_TOKEN?: string;
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
