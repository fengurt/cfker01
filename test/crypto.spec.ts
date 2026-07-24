import { describe, expect, it } from "vitest";
import { decryptDocument, encryptDocument, hashPassword, verifyPassword } from "../src/lib/crypto";

const key = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

describe("resource security primitives", () => {
  it("hashes passwords with unique PBKDF2 salts", async () => {
    const first = await hashPassword("correct horse battery staple", undefined, 10_000);
    const second = await hashPassword("correct horse battery staple", undefined, 10_000);
    expect(first.hash).not.toBe(second.hash);
    expect(first.salt).not.toBe(second.salt);
    expect(await verifyPassword("correct horse battery staple", first.hash, first.salt, first.iterations)).toBe(true);
    expect(await verifyPassword("wrong", first.hash, first.salt, first.iterations)).toBe(false);
  });

  it("round-trips AES-GCM documents with unique nonces and rejects tampering", async () => {
    const first = await encryptDocument("# private\nsecret note", key, "project-1", "content_md", "v1");
    const second = await encryptDocument("# private\nsecret note", key, "project-1", "content_md", "v1");
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toContain("secret note");
    expect(await decryptDocument(first.ciphertext, first.nonce, key, "project-1", "content_md", "v1")).toContain("secret note");
    const tampered = `${first.ciphertext.slice(0, -2)}AA`;
    await expect(decryptDocument(tampered, first.nonce, key, "project-1", "content_md", "v1")).rejects.toThrow();
    await expect(decryptDocument(first.ciphertext, first.nonce, key, "project-2", "content_md", "v1")).rejects.toThrow();
  });
});
