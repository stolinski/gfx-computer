import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { getPack } from './packs/registry';
import {
	waitForCompositionResourceReadiness,
	waitForPackFontReadiness,
	type CompositionResourceRoot
} from './composition-resource-readiness';

describe('composition resource readiness', () => {
	it('fails clearly when a required active-Pack font is unavailable', async () => {
		await assert.rejects(
			waitForPackFontReadiness(getPack('syntax'), {
				load: async () => [],
				check: () => false,
				ready: Promise.resolve()
			}),
			/Required Pack font failed to load/
		);
	});

	it('waits for stage and media resources before the final DOM flush', async () => {
		const calls: string[] = [];
		const emptyRoot: CompositionResourceRoot = { querySelectorAll: () => [] };
		await waitForCompositionResourceReadiness({
			pack: { ...getPack('syntax'), fonts: [] },
			roots: [emptyRoot],
			fontSet: { load: async () => [], check: () => true, ready: Promise.resolve() },
			waitForStage: async () => {
				calls.push('stage');
			},
			waitForMedia: async () => {
				calls.push('media');
			},
			flushDom: async () => {
				calls.push('flush');
			}
		});

		assert.deepEqual(calls.slice(0, 2).sort(), ['media', 'stage']);
		assert.equal(calls.at(-1), 'flush');
	});

	it('rejects a required composition image that failed to load', async () => {
		const failedImage = {
			complete: true,
			currentSrc: '/capture.png',
			dataset: { exportResource: 'required' },
			naturalWidth: 0,
			src: '/capture.png',
			decode: async () => undefined,
			addEventListener: () => undefined,
			removeEventListener: () => undefined
		};
		const root = {
			querySelectorAll: () => [failedImage]
		} as unknown as CompositionResourceRoot;

		await assert.rejects(
			waitForCompositionResourceReadiness({
				pack: { ...getPack('syntax'), fonts: [] },
				roots: [root],
				fontSet: { load: async () => [], check: () => true, ready: Promise.resolve() },
				waitForStage: async () => undefined,
				waitForMedia: async () => undefined,
				flushDom: async () => undefined
			}),
			/Required composition image failed to load: \/capture.png/
		);
	});
});
