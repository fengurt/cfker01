import { resolve, relative, sep } from "node:path";

export const DEFAULT_LOCAL_SCAN_ROOTS = ["/Users/af/cpro01", "/Users/af/Documents"];

export function localScanRoots({ argv = [], env = process.env } = {}) {
  const explicit = argv.filter(Boolean);
  const configured = String(env.LOCAL_SCAN_ROOTS || "")
    .split(/[;,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const legacy = env.LOCAL_SCAN_ROOT ? [env.LOCAL_SCAN_ROOT] : [];
  return [...new Set((explicit.length ? explicit : configured.length ? configured : legacy.length ? legacy : DEFAULT_LOCAL_SCAN_ROOTS).map((value) => resolve(value)))];
}

export function localPath(root, path) {
  return {
    absolutePath: resolve(path),
    relativePath: relative(resolve(root), resolve(path)).split(sep).join("/") || ".",
    scanRoot: resolve(root),
  };
}
