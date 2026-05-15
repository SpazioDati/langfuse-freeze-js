import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { vi } from 'vitest';

import { LangfuseBacked } from '../main.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CASSETTE_PATH = path.join(__dirname, 'resources', 'prompts_cassette.json');

export function loadCassette(): {
    pages: unknown[];
    prompts: Record<string, Record<string, { type: string; prompt: unknown }>>;
} {
    return JSON.parse(fs.readFileSync(CASSETTE_PATH, 'utf8'));
}

export function buildBackupFromCassette(): Record<string, { type: string; labels: Record<string, unknown> }> {
    const cassette = loadCassette();
    const backup: Record<string, { type: string; labels: Record<string, unknown> }> = {};
    for (const [name, labelData] of Object.entries(cassette.prompts)) {
        const firstLabel = Object.values(labelData)[0];
        const labels: Record<string, unknown> = {};
        for (const [label, data] of Object.entries(labelData)) {
            labels[label] = data.prompt;
        }
        backup[name] = { type: firstLabel.type, labels };
    }
    return backup;
}

/**
 * Creates a LangfuseBacked instance backed by the given JSON object instead of disk.
 * Mocks fs.existsSync and fs.readFileSync around construction, then restores them.
 */
export function makeClient(backupJson: unknown): LangfuseBacked {
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readFileSyncSpy = vi
        .spyOn(fs, 'readFileSync')
        .mockReturnValue(JSON.stringify(backupJson) as unknown as ReturnType<typeof fs.readFileSync>);

    let client: LangfuseBacked;
    try {
        client = new LangfuseBacked({ publicKey: 'pk-test', secretKey: 'sk-test', baseUrl: 'http://localhost' });
    } finally {
        existsSyncSpy.mockRestore();
        readFileSyncSpy.mockRestore();
    }

    return client;
}
