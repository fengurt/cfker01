import type { Collector, CollectorContext, CollectorResult } from "./types";

const CF_API = "https://api.cloudflare.com/client/v4";

export const collectCloudflare: Collector = async (
  ctx: CollectorContext,
): Promise<CollectorResult> => {
  const token = ctx.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    return { ok: false, payload: {}, error: "missing_cloudflare_api_token", durationMs: 0 };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const verify = await fetch(`${CF_API}/user/tokens/verify`, {
    headers,
    signal: ctx.signal,
  });
  const verifyBody = (await verify.json()) as { success: boolean; result?: { status: string } };

  let accountId = ctx.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  let subscriptions: Array<{ rate_plan?: { name?: string }; state?: string }> = [];
  if (accountId) {
    const subsRes = await fetch(
      `${CF_API}/accounts/${accountId}/subscriptions`,
      { headers, signal: ctx.signal },
    );
    const subsBody = (await subsRes.json()) as {
      success: boolean;
      result?: Array<{ rate_plan?: { name?: string }; state?: string }>;
    };
    if (subsBody.success && Array.isArray(subsBody.result)) {
      subscriptions = subsBody.result;
    }
  } else {
    const me = await fetch(`${CF_API}/user`, { headers, signal: ctx.signal });
    const meBody = (await me.json()) as {
      success: boolean;
      result?: { id?: string };
    };
    accountId = meBody.result?.id ?? "";
  }

  return {
    ok: verifyBody.success === true,
    payload: {
      tokenStatus: verifyBody.result?.status ?? "invalid",
      accountId,
      subscriptions: subscriptions.map((s) => ({
        plan: s.rate_plan?.name ?? null,
        state: s.state ?? null,
      })),
    },
    error: verifyBody.success ? undefined : "token_verify_failed",
    durationMs: 0,
  };
};