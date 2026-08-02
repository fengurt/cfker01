import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  decryptSecret,
  encryptSecret,
  rankBetween,
  safeEqual,
  serializeTask,
} from "../lib.mjs";

test("task transition policy rejects invalid jumps", () => {
  assert.equal(canTransition("backlog", "todo"), true);
  assert.equal(canTransition("backlog", "done"), false);
  assert.equal(canTransition("done", "in_progress"), true);
});

test("webhook secret encryption round trips and detects tampering", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptSecret("whsec_example", key);
  assert.notEqual(encrypted, "whsec_example");
  assert.equal(decryptSecret(encrypted, key), "whsec_example");
  assert.throws(() => decryptSecret(`${encrypted.slice(0, -2)}aa`, key));
});

test("rank and serialization preserve board-independent task data", () => {
  assert.equal(rankBetween(100, 200), 150);
  const task = serializeTask({
    id: 1,
    organization_id: "org",
    project_ids: ["a", "b"],
    primary_project_id: "b",
    project_name: "B",
    expected_value_minor: "12345",
    dependency_count: "2",
    blocked_by_count: "1",
  });
  assert.equal(task.projectName, "B");
  assert.equal(task.expectedValue, 123.45);
  assert.equal(task.dependencyCount, 2);
});

test("constant time comparison accepts equal values", () => {
  assert.equal(safeEqual("same", "same"), true);
  assert.equal(safeEqual("same", "different"), false);
});
