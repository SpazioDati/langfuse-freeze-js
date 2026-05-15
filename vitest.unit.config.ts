import { defineConfig, mergeConfig } from 'vitest/config'
// @ts-ignore
import baseConfig from './vitest.config'

export default mergeConfig(
    baseConfig,
    defineConfig({
        test: {
            include: ['**/__tests__/**/*.test.ts'],
        },
    }),
)
