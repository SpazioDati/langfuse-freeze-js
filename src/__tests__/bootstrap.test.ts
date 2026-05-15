import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LangfuseBacked } from "../main.js";

function withBackupPath(tmpPath: string, fn: () => Promise<void>): Promise<void> {
  const original = LangfuseBacked.PROMPTS_BACKUP_PATH;
  Object.defineProperty(LangfuseBacked, "PROMPTS_BACKUP_PATH", { value: tmpPath, configurable: true });
  return fn().finally(() => {
    Object.defineProperty(LangfuseBacked, "PROMPTS_BACKUP_PATH", { value: original, configurable: true });
  });
}

function tmpBackupPath(): string {
  return path.join(os.tmpdir(), `langfuse-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

describe("bootstrap", () => {
  let backupPath: string;

  beforeEach(() => {
    backupPath = tmpBackupPath();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  });

  it("skips fetch when backup already exists", async () => {
    fs.writeFileSync(backupPath, JSON.stringify({}));
    const fetchSpy = vi.spyOn(LangfuseBacked as unknown as { fetchAllPrompts: () => Promise<unknown> }, "fetchAllPrompts");

    await withBackupPath(backupPath, () => LangfuseBacked.bootstrap());

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches and writes backup when missing", async () => {
    const fakePrompts = { "my-prompt": { type: "text", labels: { production: "hello" } } };
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    vi.stubEnv("LANGFUSE_HOST", "http://localhost:10016");

    const fetchSpy = vi
      .spyOn(LangfuseBacked as unknown as { fetchAllPrompts: (pk: string, sk: string, host: string) => Promise<unknown> }, "fetchAllPrompts")
      .mockResolvedValue(fakePrompts);

    await withBackupPath(backupPath, () => LangfuseBacked.bootstrap());

    expect(fetchSpy).toHaveBeenCalledWith("pk-test", "sk-test", "http://localhost:10016");
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(backupPath, "utf8"))).toEqual(fakePrompts);

    vi.unstubAllEnvs();
  });

  it("retries on failure and succeeds", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    vi.stubEnv("LANGFUSE_HOST", "http://localhost:10016");
    vi.stubEnv("LANGFUSE_BOOTSTRAP_RETRY_DELAY", "0");
    vi.stubEnv("LANGFUSE_BOOTSTRAP_MAX_RETRIES", "3");

    const fakePrompts = { p: { type: "text", labels: { production: "x" } } };
    let callCount = 0;

    vi.spyOn(
      LangfuseBacked as unknown as { fetchAllPrompts: () => Promise<unknown> },
      "fetchAllPrompts",
    ).mockImplementation(async () => {
      callCount++;
      if (callCount < 2) throw new Error("timeout");
      return fakePrompts;
    });

    await withBackupPath(backupPath, () => LangfuseBacked.bootstrap());

    expect(callCount).toBe(2);
    expect(fs.existsSync(backupPath)).toBe(true);

    vi.unstubAllEnvs();
  });

  it("throws after max retries exhausted", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    vi.stubEnv("LANGFUSE_HOST", "http://localhost:10016");
    vi.stubEnv("LANGFUSE_BOOTSTRAP_RETRY_DELAY", "0");
    vi.stubEnv("LANGFUSE_BOOTSTRAP_MAX_RETRIES", "3");

    vi.spyOn(
      LangfuseBacked as unknown as { fetchAllPrompts: () => Promise<unknown> },
      "fetchAllPrompts",
    ).mockRejectedValue(new Error("down"));

    await expect(withBackupPath(backupPath, () => LangfuseBacked.bootstrap())).rejects.toThrow("3 attempts");

    vi.unstubAllEnvs();
  });

  it("throws when LANGFUSE_PUBLIC_KEY missing", async () => {
    const orig = process.env["LANGFUSE_PUBLIC_KEY"];
    delete process.env["LANGFUSE_PUBLIC_KEY"];
    process.env["LANGFUSE_SECRET_KEY"] = "sk-test";
    process.env["LANGFUSE_HOST"] = "http://localhost:10016";

    try {
      await expect(withBackupPath(backupPath, () => LangfuseBacked.bootstrap())).rejects.toThrow(
        "LANGFUSE_PUBLIC_KEY",
      );
    } finally {
      if (orig !== undefined) process.env["LANGFUSE_PUBLIC_KEY"] = orig;
      delete process.env["LANGFUSE_SECRET_KEY"];
      delete process.env["LANGFUSE_HOST"];
    }
  });
});
