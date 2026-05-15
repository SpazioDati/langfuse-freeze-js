import { LangfuseBacked } from './main.js';

export { LangfuseBacked };

if (!process.env['LANGFUSE_DISABLE_BOOTSTRAP']) {
    try {
        await LangfuseBacked.bootstrap();
    } catch (e) {
        throw new Error(
            `Langfuse bootstrap failed at import time. Set LANGFUSE_DISABLE_BOOTSTRAP=1 to skip. Original error: ${e}`,
            { cause: e },
        );
    }
}
