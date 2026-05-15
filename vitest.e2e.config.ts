import fs from "node:fs";
import path from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
// @ts-ignore
import baseConfig from "./vitest.config";

function parseDotEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return {};
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["**/__tests__/**/*.e2e.ts"],
      testTimeout: 60000,
      maxConcurrency: 1,
      env: parseDotEnv(),
    },
  }),
);
