#!/usr/bin/env node

process.env["LANGFUSE_DISABLE_BOOTSTRAP"] = "1";

import { LangfuseBacked } from "./main.js";

async function main(): Promise<void> {
  try {
    await LangfuseBacked.bootstrap();
  } catch (e) {
    console.error(`Bootstrap failed: ${e}`);
    process.exit(1);
  }
}

await main();
