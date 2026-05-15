# langfuse-freeze

Wraps the Langfuse client to snapshot prompts to disk at startup. If Langfuse is unreachable at runtime, the local backup is used as fallback.

## How it works

On `import "langfuse-freeze"`, `LangfuseBacked.bootstrap()` runs automatically:
- Backup file already exists → skip (log and continue)
- Backup file missing → fetch all prompts from Langfuse, write to disk
- Fetch fails → retry with exponential backoff, throw `Error` after max retries

At runtime, `LangfuseBacked` proxies `prompt.get()` to inject the backup as `fallback` so the Langfuse SDK handles outages gracefully.

## Installation

```bash
pnpm add langfuse-freeze
```

## Usage

```ts
import { LangfuseBacked } from "langfuse-freeze";

const client = new LangfuseBacked();
const prompt = await client.prompt.get("my-prompt", { type: "text", label: "production" });
```

Drop-in replacement for `LangfuseClient`. Same API.

## Bootstrap at container build time

Run before the app starts (e.g. in a Dockerfile or k8s init container):

```bash
langfuse-freeze
```

Same logic as import-time bootstrap — skips if backup already present.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `LANGFUSE_PUBLIC_KEY` | — | Required |
| `LANGFUSE_SECRET_KEY` | — | Required |
| `LANGFUSE_HOST` | — | Required |
| `LANGFUSE_PROMPTS_BACKUP_PATH` | `./langfuse-backup/prompts.json` | Backup file location |
| `LANGFUSE_BOOTSTRAP_MAX_RETRIES` | `3` | Fetch attempts before crash |
| `LANGFUSE_BOOTSTRAP_RETRY_DELAY` | `2` | Base seconds for exponential backoff |
| `LANGFUSE_DISABLE_BOOTSTRAP` | — | Set to `1` to skip import-time bootstrap |

## Backup format

```json
{
  "my-prompt": {
    "type": "text",
    "labels": {
      "production": "You are a helpful assistant.",
      "dev": "You are a dev assistant."
    }
  }
}
```

To refresh the backup, delete the file and restart (or re-run `langfuse-freeze`).

## Running tests

Unit tests (no network):

```bash
pnpm test
```

E2E tests (requires Langfuse running at `http://localhost:10016`):

```bash
pnpm test:e2e
```
