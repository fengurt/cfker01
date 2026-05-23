type LogLevel = "debug" | "info" | "warn" | "error";

export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      level,
      event,
      service: "cfker01",
      timestamp: new Date().toISOString(),
      ...fields,
    }),
  );
}
