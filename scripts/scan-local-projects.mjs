import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const root = resolve(process.argv[2] || "/Users/af/cpro01");
const output = resolve(process.env.LOCAL_SCAN_OUTPUT || resolve(import.meta.dirname, "../src/generated/local-projects.json"));
const ignored = new Set(["node_modules", ".next", ".open-next", ".astro", ".wrangler", ".git", "dist", "build", "coverage", ".venv", "venv", "vendor", "target", "__pycache__", ".cache", ".vite"]);
const markers = new Set(["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "wrangler.jsonc", "SKILL.md", "AGENTS.md"]);
const resources = new Map();

const scannedAt = new Date().toISOString();
await walk(root);
const list = [...resources.values()].map(finalize).sort((a, b) => a.sourceRef.localeCompare(b.sourceRef));
const result = { generatedAt: scannedAt, scanRoot: "cpro01", count: list.length, resources: list };
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Scanned ${root}: ${list.length} resources written to ${output}`);

async function walk(directory) {
  let items; try { items = await readdir(directory, { withFileTypes: true }); } catch { return; }
  const git = items.find((item) => item.isDirectory() && item.name === ".git");
  if (git) await addResource(directory, ".git", "repository");
  for (const item of items) {
    if (item.isDirectory()) { if (!ignored.has(item.name)) await walk(join(directory, item.name)); continue; }
    if (item.isFile() && markers.has(item.name)) await addResource(directory, item.name, markerType(item.name));
  }
}

async function addResource(directory, marker, type) {
  const markerPath = join(directory, marker);
  const resourcePath = marker === "SKILL.md" ? markerPath : directory;
  const sourceRef = relative(root, resourcePath).split(sep).join("/") || ".";
  const key = sourceRef;
  const existing = resources.get(key) || { sourceRef, name: basename(directory), description: null, resourceTypes: new Set(), markers: [], languages: new Set(), frameworks: new Set(), repositoryUrl: null, discoveredAt: new Date().toISOString(), sourceUpdatedAt: null, entrypoints: new Set(), workspaces: [] };
  existing.resourceTypes.add(type); existing.markers.push(marker);
  try { const info = await stat(markerPath); existing.discoveredAt = info.birthtime.toISOString(); if(marker!==".git"){const modified=info.mtime.toISOString();if(!existing.sourceUpdatedAt||modified>existing.sourceUpdatedAt)existing.sourceUpdatedAt=modified;} } catch {}
  if (marker === "package.json") await applyPackage(existing, markerPath);
  if (marker === "pyproject.toml") await applyPyproject(existing, markerPath);
  if (marker === "Cargo.toml") { existing.languages.add("Rust"); existing.frameworks.add("Cargo"); }
  if (marker === "go.mod") { existing.languages.add("Go"); existing.frameworks.add("Go modules"); }
  if (marker === "wrangler.jsonc") existing.frameworks.add("Cloudflare Workers");
  if (marker === "SKILL.md") await applySkill(existing, markerPath);
  if (marker === ".git") { existing.repositoryUrl = await gitRemote(markerPath); const git = await gitInfo(directory); existing.gitHead = git.head; existing.gitCommitAt = git.committedAt; existing.gitDirty = git.dirty; if (git.committedAt && (!existing.sourceUpdatedAt || git.committedAt > existing.sourceUpdatedAt)) existing.sourceUpdatedAt = git.committedAt; }
  resources.set(key, existing);
}

async function applyPackage(resource, path) { try { const data = JSON.parse(await readFile(path, "utf8")); if (data.name) resource.name = String(data.name); if (data.description) resource.description = String(data.description); resource.languages.add("TypeScript/JavaScript"); for(const value of[data.main,data.module,data.bin&&typeof data.bin==="string"?data.bin:null])if(value)resource.entrypoints.add(String(value));for(const [name,command] of Object.entries(data.scripts??{}))if(["start","dev","serve","worker"].includes(name))resource.entrypoints.add(`script:${name}=${command}`);resource.workspaces=Array.isArray(data.workspaces)?data.workspaces:Array.isArray(data.workspaces?.packages)?data.workspaces.packages:resource.workspaces; const all = {...data.dependencies,...data.devDependencies}; if (all.next) resource.frameworks.add("Next.js"); if (all.astro) resource.frameworks.add("Astro"); if (all.react) resource.frameworks.add("React"); if (all.vue) resource.frameworks.add("Vue"); if (all.wrangler) resource.frameworks.add("Cloudflare Workers"); } catch {} }
async function applyPyproject(resource, path) { try { const text = await readFile(path, "utf8"); resource.languages.add("Python"); resource.frameworks.add("Python project"); const name = text.match(/^name\s*=\s*["']([^"']+)/m)?.[1]; const description = text.match(/^description\s*=\s*["']([^"']+)/m)?.[1]; if (name) resource.name = name; if (description) resource.description = description; } catch {} }
async function applySkill(resource, path) { try { const text = await readFile(path, "utf8"); resource.name = text.match(/^name:\s*["']?([^\n"']+)/m)?.[1]?.trim() || resource.name; resource.description = text.match(/^description:\s*["']?([^\n"']+)/m)?.[1]?.trim() || resource.description; resource.languages.add("Markdown"); resource.frameworks.add("Agent Skill"); } catch {} }
async function gitRemote(gitDir) { try { const text = await readFile(join(gitDir, "config"), "utf8"); return text.match(/url\s*=\s*(.+)/)?.[1]?.trim() || null; } catch { return null; } }
async function gitInfo(directory) { try { const [{ stdout },status] = await Promise.all([exec("git", ["-C", directory, "log", "-1", "--format=%H%n%cI"], { timeout: 3000, maxBuffer: 4096 }),exec("git",["-C",directory,"status","--porcelain"],{timeout:3000,maxBuffer:100_000}).catch(()=>({stdout:""}))]); const [head, committedAt] = stdout.trim().split("\n"); return { head: head || null, committedAt: committedAt || null,dirty:Boolean(status.stdout.trim()) }; } catch { return { head: null, committedAt: null,dirty:false }; } }
function markerType(marker) { if (marker === "SKILL.md") return "skill"; if (marker === "AGENTS.md") return "agent"; return "project"; }
function finalize(resource) { const id = `local-${createHash("sha256").update(resource.sourceRef).digest("hex").slice(0, 16)}`; const description = resource.description?.replaceAll("—", "-").replaceAll("–", "-") ?? null; return { id, name: resource.name, description, resourceTypes: [...resource.resourceTypes].sort(), platform: "local-filesystem", sourceKind: resource.resourceTypes.has("repository") ? "git-repository" : "detected-project", sourceRef: resource.sourceRef, repositoryUrl: resource.repositoryUrl, languages: [...resource.languages].sort(), frameworks: [...resource.frameworks].sort(), status: "draft", visibility: "public", discoveredAt: resource.discoveredAt, sourceUpdatedAt:resource.sourceUpdatedAt, lastScannedAt:scannedAt, metadata: { markers: [...new Set(resource.markers)].sort(), needsDescription: !description, entrypoints:[...resource.entrypoints].slice(0,20), workspaces:resource.workspaces.slice(0,30), gitHead:resource.gitHead??null, gitCommitAt:resource.gitCommitAt??null,gitDirty:Boolean(resource.gitDirty) } }; }
