export type IncidentSeverity = "p0" | "p1" | "p2" | "p3";

export type IncidentSignals = {
  affectedProductionProjects?: number;
  productionImpact?: boolean;
  dataLoss?: boolean;
  security?: boolean;
  coreConsoleDown?: boolean;
  criticalProjectDown?: boolean;
  diskExhaustion?: boolean;
  backupFailure?: boolean;
  expiryHours?: number | null;
  degraded?: boolean;
  versionDrift?: boolean;
  stale?: boolean;
  missingDescription?: boolean;
  lowConfidence?: boolean;
};

export type IncidentFingerprintInput = {
  entityType: string;
  entityId: string;
  check: string;
  rootCause: string;
  evidence?: string[];
};

export function classifyIncident(signals: IncidentSignals): IncidentSeverity {
  if (signals.dataLoss || signals.security || signals.coreConsoleDown || (signals.productionImpact && Number(signals.affectedProductionProjects) >= 2)) return "p0";
  if (signals.criticalProjectDown || signals.diskExhaustion || signals.backupFailure || (signals.expiryHours != null && signals.expiryHours <= 24)) return "p1";
  if (signals.degraded || signals.versionDrift || signals.stale || (signals.expiryHours != null && signals.expiryHours <= 7 * 24)) return "p2";
  return "p3";
}

export function incidentFingerprint(input: IncidentFingerprintInput): string {
  const evidence = [...new Set(input.evidence ?? [])].map(String).sort();
  return [input.entityType, input.entityId, input.check, input.rootCause, evidence.join(",")].map((part) => String(part).trim().toLowerCase()).join(":");
}

export function notificationPlan(severity: IncidentSeverity, _quietHours: boolean): Array<"inbox" | "sms" | "digest"> {
  if (severity === "p0" || severity === "p1") return ["inbox", "sms"];
  if (severity === "p2") return ["inbox", "digest"];
  return ["inbox"];
}
