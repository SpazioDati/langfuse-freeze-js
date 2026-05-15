import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LangfuseBacked } from "../main.js";
import { TextPromptClient, ChatPromptClient } from "@langfuse/client";

const LANGFUSE_HOST = process.env["LANGFUSE_HOST"] || process.env["LANGFUSE_BASE_URL"] || "http://localhost:10015";

function setLangfuseEnv(): void {
  process.env["LANGFUSE_PUBLIC_KEY"] = process.env["LANGFUSE_PUBLIC_KEY"] || "pk-lf-1234";
  process.env["LANGFUSE_SECRET_KEY"] = process.env["LANGFUSE_SECRET_KEY"] || "sk-lf-1234";
  process.env["LANGFUSE_HOST"] = LANGFUSE_HOST;
}

function makeFreshBackupPath(): string {
  return path.join(os.tmpdir(), `langfuse-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function withBackupPath<T>(tmpPath: string, fn: () => Promise<T>): Promise<T> {
  const original = LangfuseBacked.PROMPTS_BACKUP_PATH;
  Object.defineProperty(LangfuseBacked, "PROMPTS_BACKUP_PATH", { value: tmpPath, configurable: true });
  return fn().finally(() => {
    Object.defineProperty(LangfuseBacked, "PROMPTS_BACKUP_PATH", { value: original, configurable: true });
  });
}

describe("integration", () => {
  let backupPath: string;

  beforeEach(() => {
    setLangfuseEnv();
    backupPath = makeFreshBackupPath();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  });

  it("bootstrap fetches and writes real prompts", async () => {
    await withBackupPath(backupPath, async () => {
      await LangfuseBacked.bootstrap();

      expect(fs.existsSync(backupPath)).toBe(true);

      const data = JSON.parse(fs.readFileSync(backupPath, "utf8")) as Record<
        string,
        { type: string; labels: Record<string, unknown> }
      >;

      expect(Object.keys(data).length).toBeGreaterThan(0);

      for (const entry of Object.values(data)) {
        expect(["text", "chat"]).toContain(entry.type);
        expect(entry.labels).toBeDefined();
        expect(entry.labels["production"]).toBeDefined();

        if (entry.type === "chat") {
          const msgs = entry.labels["production"] as Record<string, unknown>[];
          expect(msgs[0]).toHaveProperty("content");
          expect(msgs[0]).toHaveProperty("role");
        } else {
          expect(typeof entry.labels["production"]).toBe("string");
          expect(entry.labels["production"]).toBeTruthy();
        }
      }
    });
  });

  it("bootstrap skips when backup already exists", async () => {
    await withBackupPath(backupPath, async () => {
      await LangfuseBacked.bootstrap();
      const mtime1 = fs.statSync(backupPath).mtimeMs;

      await LangfuseBacked.bootstrap();
      const mtime2 = fs.statSync(backupPath).mtimeMs;

      expect(mtime1).toBe(mtime2);
    });
  });

  it("get text prompt returns TextPromptClient", async () => {
    await withBackupPath(backupPath, async () => {
      await LangfuseBacked.bootstrap();

      const data = JSON.parse(fs.readFileSync(backupPath, "utf8")) as Record<
        string,
        { type: string; labels: Record<string, unknown> }
      >;
      const textPromptName = Object.entries(data).find(([, v]) => v.type === "text")?.[0];
      if (!textPromptName) return;

      const client = new LangfuseBacked({
        publicKey: process.env["LANGFUSE_PUBLIC_KEY"],
        secretKey: process.env["LANGFUSE_SECRET_KEY"],
        baseUrl: LANGFUSE_HOST,
      });

      const result = await client.prompt.get(textPromptName, { type: "text" });
      expect(result).toBeInstanceOf(TextPromptClient);
    });
  });

  it("get chat prompt returns ChatPromptClient", async () => {
    await withBackupPath(backupPath, async () => {
      await LangfuseBacked.bootstrap();

      const data = JSON.parse(fs.readFileSync(backupPath, "utf8")) as Record<
        string,
        { type: string; labels: Record<string, unknown> }
      >;
      const chatPromptName = Object.entries(data).find(([, v]) => v.type === "chat")?.[0];
      if (!chatPromptName) return;

      const client = new LangfuseBacked({
        publicKey: process.env["LANGFUSE_PUBLIC_KEY"],
        secretKey: process.env["LANGFUSE_SECRET_KEY"],
        baseUrl: LANGFUSE_HOST,
      });

      const result = await client.prompt.get(chatPromptName, { type: "chat" });
      expect(result).toBeInstanceOf(ChatPromptClient);
    });
  });

  it("fallback used when Langfuse unreachable", async () => {
    await withBackupPath(backupPath, async () => {
      await LangfuseBacked.bootstrap();

      const data = JSON.parse(fs.readFileSync(backupPath, "utf8")) as Record<
        string,
        { type: string; labels: Record<string, unknown> }
      >;
      if (Object.keys(data).length === 0) return;

      const [promptName, entry] = Object.entries(data)[0];

      const client = new LangfuseBacked({
        publicKey: "pk-lf-invalid",
        secretKey: "sk-lf-invalid",
        baseUrl: "http://localhost:19999",
      });

      const result = await client.prompt.get(promptName, {
        type: entry.type as "text" | "chat",
      } as Parameters<typeof client.prompt.get>[1]);

      expect(result).toBeDefined();
    });
  });
});
