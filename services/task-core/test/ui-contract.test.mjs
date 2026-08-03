import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const workspace = readFileSync(
  new URL("../../../src/components/AdminWorkspace.astro", import.meta.url),
  "utf8",
);
const script = readFileSync(
  new URL("../../../public/admin-tasks.js", import.meta.url),
  "utf8",
);

test("quick task Enter path has one submit control", () => {
  const form = workspace.match(
    /<form method="dialog" id="quick-task-form">([\s\S]*?)<\/form>/,
  )?.[1];

  assert.ok(form);
  assert.equal(form.match(/type="submit"/g)?.length, 1);
  assert.equal(form.match(/type="button" value="cancel"/g)?.length, 2);
});

test("quick task async submit is controlled and reports inline errors", () => {
  assert.match(
    script,
    /\$\("#quick-task-form"\)\.addEventListener\("submit", async \(event\) => \{/,
  );
  assert.match(script, /event\.preventDefault\(\);/);
  assert.match(script, /errorNode\.textContent = error\.message;/);
  assert.match(script, /form\.setAttribute\("aria-busy", "true"\)/);
  assert.match(script, /form\.requestSubmit\(\$\("#quick-task-submit"\)\)/);
});
