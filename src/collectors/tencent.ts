import { tc3Request } from "../lib/tc3";
import type { Collector, CollectorContext, CollectorResult } from "./types";

const REGION = "ap-guangzhou";

interface CamResp {
  Response: { AppId: number; Uin: string; OwnerUin: string };
}
interface BalanceResp {
  Response: {
    Balance: number;
    RealBalance: number;
    CashAccountBalance: number;
    OweAmount: number;
  };
}
interface ZonesResp {
  Response: { TotalCount: number; Zones?: Array<{ ZoneId: string; ZoneName: string }> };
}

export const collectTencent: Collector = async (
  ctx: CollectorContext,
): Promise<CollectorResult> => {
  const { secretId, secretKey } = ctx.env as unknown as {
    secretId?: string;
    secretKey?: string;
  };
  if (!secretId || !secretKey) {
    return { ok: false, payload: {}, error: "missing_tencent_credentials", durationMs: 0 };
  }

  const common = {
    secretId,
    secretKey,
    region: REGION,
    signal: ctx.signal,
  } as const;

  const [app, balance, zones] = await Promise.all([
    tc3Request<CamResp>({
      ...common,
      host: "cam.tencentcloudapi.com",
      service: "cam",
      action: "GetUserAppId",
      version: "2019-01-16",
    }),
    tc3Request<BalanceResp>({
      ...common,
      host: "billing.tencentcloudapi.com",
      service: "billing",
      action: "DescribeAccountBalance",
      version: "2018-07-09",
    }),
    tc3Request<ZonesResp>({
      ...common,
      host: "teo.tencentcloudapi.com",
      service: "teo",
      action: "DescribeZones",
      version: "2022-09-01",
      payload: { Limit: 50 },
    }),
  ]);

  return {
    ok: true,
    payload: {
      appId: app.Response.AppId,
      uin: app.Response.Uin,
      ownerUin: app.Response.OwnerUin,
      balanceCNY: balance.Response.RealBalance / 100,
      frozen: balance.Response.OweAmount / 100,
      edgeone: {
        zoneCount: zones.Response.TotalCount,
        zones: (zones.Response.Zones ?? []).slice(0, 10).map((z) => ({
          id: z.ZoneId,
          name: z.ZoneName,
        })),
      },
      region: REGION,
    },
    durationMs: 0,
  };
};