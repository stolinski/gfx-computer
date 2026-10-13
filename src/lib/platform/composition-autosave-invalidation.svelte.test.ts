import { describe, expect, it } from 'vite-plus/test';

import {
	compositionAutosaveInvalidation,
	invalidateCompositionAutosave
} from './composition-autosave-invalidation.svelte.ts';

describe('composition autosave invalidation', () => {
	it('provides a stable dependency for topology-removal autosaves', () => {
		const previousRevision = compositionAutosaveInvalidation.revision;
		invalidateCompositionAutosave();
		expect(compositionAutosaveInvalidation.revision).toBe(previousRevision + 1);
	});
});
