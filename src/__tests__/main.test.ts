import fs from 'node:fs';

import { PromptManager } from '@langfuse/client';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { LangfuseBacked } from '../main.js';
import { buildBackupFromCassette, makeClient } from './helpers.js';

describe('LangfuseBacked constructor', () => {
    afterEach(() => vi.restoreAllMocks());

    it('throws when backup file missing', () => {
        expect(() => new LangfuseBacked({ publicKey: 'pk', secretKey: 'sk', baseUrl: 'http://localhost' })).toThrow(
            /No prompts backup found/,
        );
    });

    it('throws when backup file contains invalid JSON', () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'readFileSync').mockReturnValue('not-json');
        expect(() => new LangfuseBacked({ publicKey: 'pk', secretKey: 'sk', baseUrl: 'http://localhost' })).toThrow(
            /invalid JSON/,
        );
    });
});

describe('prompt.get fallback injection', () => {
    afterEach(() => vi.restoreAllMocks());

    it('injects chat fallback from production label', async () => {
        const client = makeClient(buildBackupFromCassette());
        const getSpy = vi.spyOn(PromptManager.prototype, 'get').mockResolvedValue({} as never);

        await client.prompt.get('ask-fitch', { type: 'chat' });

        const options = getSpy.mock.calls[0][1] as Record<string, unknown>;
        const fallback = options['fallback'] as Record<string, unknown>[];
        expect(Array.isArray(fallback)).toBe(true);
        expect(fallback[0]['type']).toBe('chatmessage');
        expect(fallback[0]['role']).toBe('system');
        expect(String(fallback[0]['content'])).toMatch(/^## General Instruction\nToday is \{\{date\}\}\./);
    });

    it('injects text fallback from specific label', async () => {
        const client = makeClient(buildBackupFromCassette());
        const getSpy = vi.spyOn(PromptManager.prototype, 'get').mockResolvedValue({} as never);

        await client.prompt.get('sentovel-entities-select', { type: 'text', label: 'dev' });

        const options = getSpy.mock.calls[0][1] as Record<string, unknown>;
        expect(String(options['fallback'])).toMatch(
            /^Sei un esperto di economia italiana e di ecosistemi dati aziendali\. Oggi è \{\{today\}\}\./,
        );
    });

    it('falls back to production when requested label not found', async () => {
        const client = makeClient(buildBackupFromCassette());
        const getSpy = vi.spyOn(PromptManager.prototype, 'get').mockResolvedValue({} as never);

        await client.prompt.get('ask-fitch', { type: 'chat', label: 'non-existing' });

        const options = getSpy.mock.calls[0][1] as Record<string, unknown>;
        const fallback = options['fallback'] as Record<string, unknown>[];
        expect(fallback[0]['type']).toBe('chatmessage');
        expect(fallback[0]['role']).toBe('system');
        expect(String(fallback[0]['content'])).toMatch(/^## General Instruction\nToday is \{\{date\}\}\./);
    });

    it('injects text fallback for specific label on text prompt', async () => {
        const client = makeClient(buildBackupFromCassette());
        const getSpy = vi.spyOn(PromptManager.prototype, 'get').mockResolvedValue({} as never);

        await client.prompt.get('sentovel-rag-select-text', { type: 'text', label: 'dev' });

        const options = getSpy.mock.calls[0][1] as Record<string, unknown>;
        expect(String(options['fallback'])).toMatch(/^Sei un esperto di economia italiana e oggi è \{\{today\}\}\./);
        expect(String(options['fallback'])).not.toContain('## Passo 3 — Cerca corrispondenze per OGNI concetto');
    });

    it('uses production fallback when label nonexistent on text prompt', async () => {
        const client = makeClient(buildBackupFromCassette());
        const getSpy = vi.spyOn(PromptManager.prototype, 'get').mockResolvedValue({} as never);

        await client.prompt.get('sentovel-rag-select-text', { type: 'text', label: 'nonexistent' });

        const options = getSpy.mock.calls[0][1] as Record<string, unknown>;
        expect(String(options['fallback'])).toMatch(
            /^Sei un esperto di economia italiana e di ecosistemi dati aziendali\. Oggi è \{\{today\}\}\./,
        );
    });

    it('does not override explicit fallback provided by caller', async () => {
        const client = makeClient(buildBackupFromCassette());
        const getSpy = vi.spyOn(PromptManager.prototype, 'get').mockResolvedValue({} as never);

        await client.prompt.get('sentovel-rag-select-text', { type: 'text', fallback: 'custom fallback' });

        const options = getSpy.mock.calls[0][1] as Record<string, unknown>;
        expect(options['fallback']).toBe('custom fallback');
    });

    it('passes no fallback for unknown prompt', async () => {
        const client = makeClient(buildBackupFromCassette());
        const getSpy = vi.spyOn(PromptManager.prototype, 'get').mockResolvedValue({} as never);

        await client.prompt.get('unknown-prompt', { type: 'text' });

        const options = getSpy.mock.calls[0][1] as Record<string, unknown>;
        expect(options['fallback']).toBeUndefined();
    });
});
