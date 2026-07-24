import { describe, expect, it } from "vitest";
import { canonicalRepository, safeReviewPayload } from "../src/lib/repository-review";

describe("repository review normalization",()=>{
  it.each([
    ["git@github.com:OpenAI/codex.git","github.com/openai/codex"],
    ["https://github.com/OpenAI/codex.git","github.com/openai/codex"],
    ["ssh://git@github.com/OpenAI/codex","github.com/openai/codex"],
  ])("normalizes %s",(input,key)=>expect(canonicalRepository(input)?.key).toBe(key));

  it("rejects non-repository strings",()=>expect(canonicalRepository("not a remote")).toBeNull());
  it("accepts bounded redacted dossiers",()=>expect(safeReviewPayload({canonicalKey:"github.com/a/b",fingerprint:"abc",dossier:"safe facts"})).toBe(true));
  it("rejects secrets and oversized dossiers",()=>{
    expect(safeReviewPayload({canonicalKey:"x",fingerprint:"y",dossier:"api_key=super-secret-value"})).toBe(false);
    expect(safeReviewPayload({canonicalKey:"x",fingerprint:"y",dossier:"x".repeat(20_000)})).toBe(false);
  });
});
