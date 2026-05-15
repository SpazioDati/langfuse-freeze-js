import fs from 'node:fs';
import path from 'node:path';

import {
    LangfuseClient,
    type LangfuseClientParams,
    type ChatPromptClient,
    type TextPromptClient,
    type PromptManager,
} from '@langfuse/client';

const PROMPTS_BACKUP_PATH = process.env['LANGFUSE_PROMPTS_BACKUP_PATH'] ?? './langfuse-backup/prompts.json';

function getMaxRetries(): number {
    return parseInt(process.env['LANGFUSE_BOOTSTRAP_MAX_RETRIES'] ?? '3', 10);
}

function getRetryDelay(): number {
    return parseFloat(process.env['LANGFUSE_BOOTSTRAP_RETRY_DELAY'] ?? '2');
}

type ChatGetOptions = NonNullable<Parameters<PromptManager['get']>[1]> & { type: 'chat' };
type TextGetOptions = NonNullable<Parameters<PromptManager['get']>[1]> & { type?: 'text' };
type ChatFallback = NonNullable<ChatGetOptions['fallback']>;
type TextFallback = NonNullable<TextGetOptions['fallback']>;

type PromptContent = TextFallback | ChatFallback;

interface PromptBackupEntry {
    type: 'text' | 'chat';
    labels: Record<string, PromptContent>;
}

type PromptsBackup = Record<string, PromptBackupEntry>;

export class LangfuseBacked extends LangfuseClient {
    static readonly PROMPTS_BACKUP_PATH = PROMPTS_BACKUP_PATH;

    private readonly promptsBackup: PromptsBackup;

    constructor(params?: LangfuseClientParams) {
        super(params);

        const backupPath = LangfuseBacked.PROMPTS_BACKUP_PATH;

        if (!fs.existsSync(backupPath)) {
            throw new Error(
                `No prompts backup found at ${backupPath}. ` +
                    'Run LangfuseBacked.bootstrap() first or ensure the backup file exists ' +
                    "by removing 'LANGFUSE_DISABLE_BOOTSTRAP' from env vars.",
            );
        }

        let rawBackup: unknown;
        try {
            rawBackup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        } catch (e) {
            throw new Error(`Prompts backup at ${backupPath} contains invalid JSON: ${e}`, { cause: e });
        }

        this.promptsBackup = LangfuseBacked.normalizeBackup(rawBackup as PromptsBackup);
        console.info(`Loaded ${Object.keys(this.promptsBackup).length} prompts from backup`);

        // Wrap prompt.get to inject backup fallback when none is provided
        const originalPrompt = this.prompt;
        const getBackupFallback = this.getBackupFallback.bind(this);

        this.prompt = new Proxy(originalPrompt, {
            get(target, prop) {
                if (prop !== 'get') return Reflect.get(target, prop, target);

                return (
                    name: string,
                    options?: Parameters<PromptManager['get']>[1],
                ): Promise<TextPromptClient | ChatPromptClient> => {
                    const resolved = { ...options } as Record<string, unknown>;
                    if (resolved['fallback'] === undefined) {
                        resolved['fallback'] = getBackupFallback(name, options?.label);
                    }
                    return target.get(name, resolved as Parameters<PromptManager['get']>[1]);
                };
            },
        });
    }

    private getBackupFallback(name: string, label?: string): PromptContent | undefined {
        const entry = this.promptsBackup[name];
        if (entry === undefined) {
            console.warn('Asking for a prompt that is not present in the backup');
            return undefined;
        }

        // if label missing, fall back to 'production' which is always present
        const key = label !== undefined && label in entry.labels ? label : 'production';
        return entry.labels[key];
    }

    static async bootstrap(): Promise<void> {
        const backupPath = LangfuseBacked.PROMPTS_BACKUP_PATH;

        if (fs.existsSync(backupPath)) {
            console.info(`Backup already present at ${backupPath}, skipping`);
            return;
        }

        const publicKey = process.env['LANGFUSE_PUBLIC_KEY'];
        const secretKey = process.env['LANGFUSE_SECRET_KEY'];
        const baseUrl = process.env['LANGFUSE_HOST'];

        if (!publicKey) throw new Error('MISSING `LANGFUSE_PUBLIC_KEY` in env');
        if (!secretKey) throw new Error('MISSING `LANGFUSE_SECRET_KEY` in env');
        if (!baseUrl) throw new Error('MISSING `LANGFUSE_HOST` in env');

        const maxRetries = getMaxRetries();
        const retryDelay = getRetryDelay();

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const prompts = await LangfuseBacked.fetchAllPrompts(publicKey, secretKey, baseUrl);
                LangfuseBacked.writeBackup(prompts);
                console.info(`Saved ${Object.keys(prompts).length} prompts to ${backupPath}`);
                return;
            } catch (e) {
                console.warn(`Fetch attempt ${attempt + 1}/${maxRetries} failed: ${e}`);
                if (attempt < maxRetries - 1) {
                    await sleep(retryDelay * Math.pow(2, attempt) * 1000);
                }
            }
        }

        throw new Error(`Failed to fetch prompts from Langfuse after ${maxRetries} attempts`);
    }

    private static async fetchAllPrompts(
        publicKey: string,
        secretKey: string,
        baseUrl: string,
    ): Promise<PromptsBackup> {
        const client = new LangfuseClient({ publicKey, secretKey, baseUrl });
        const backup: PromptsBackup = {};
        let page = 1;

        while (true) {
            const response = await client.api.prompts.list({ page });
            const promptsMeta = response.data;

            if (promptsMeta.length === 0) break;

            for (const promptMeta of promptsMeta) {
                const labels: Record<string, PromptContent> = {};

                for (const label of promptMeta.labels) {
                    const promptClient = await client.prompt.get(promptMeta.name, {
                        label,
                        type: promptMeta.type as 'text' | 'chat',
                    } as Parameters<PromptManager['get']>[1]);
                    labels[label] = promptClient.prompt as PromptContent;
                }

                backup[promptMeta.name] = {
                    type: promptMeta.type as 'text' | 'chat',
                    labels,
                };
            }

            page++;
        }

        return backup;
    }

    private static normalizeChatMessage(msg: Record<string, unknown>): Record<string, unknown> {
        // v3 used type='message'; v4 uses 'chatmessage' or 'placeholder'
        if ('name' in msg && !('role' in msg) && !('content' in msg)) {
            return { ...msg, type: 'placeholder' };
        }
        if ('role' in msg && 'content' in msg) {
            return { ...msg, type: 'chatmessage' };
        }
        return msg;
    }

    static normalizeBackup(backup: Record<string, { type: string; labels: Record<string, unknown> }>): PromptsBackup {
        const normalized: PromptsBackup = {};

        for (const [name, entry] of Object.entries(backup)) {
            if (entry.type !== 'chat') {
                normalized[name] = entry as PromptBackupEntry;
                continue;
            }

            const normalizedLabels: Record<string, PromptContent> = {};
            for (const [label, prompt] of Object.entries(entry.labels)) {
                if (Array.isArray(prompt)) {
                    normalizedLabels[label] = (prompt as Record<string, unknown>[]).map(
                        LangfuseBacked.normalizeChatMessage,
                    ) as unknown as ChatFallback;
                } else {
                    normalizedLabels[label] = prompt as PromptContent;
                }
            }

            normalized[name] = { type: 'chat', labels: normalizedLabels };
        }

        return normalized;
    }

    private static writeBackup(prompts: PromptsBackup): void {
        const backupPath = LangfuseBacked.PROMPTS_BACKUP_PATH;
        fs.mkdirSync(path.dirname(path.resolve(backupPath)), { recursive: true });
        fs.writeFileSync(backupPath, JSON.stringify(prompts, null, 2));
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
