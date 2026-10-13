import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { normalizedPassRegion, resolvePassExecution } from './pass-execution';

describe('render pass execution', () => {
	it('clamps an inflated local region to native horizontal bounds', () => {
		const region = normalizedPassRegion([0.8, 0.75, 0.3, 0.4], 3840, 2160, 24);
		assert.deepEqual(resolvePassExecution({ region }, 3840, 2160), {
			mode: 'region',
			region: { x: 3048, y: 1596, width: 792, height: 564 },
			targetWidth: 3840,
			targetHeight: 2160
		});
	});

	it('allocates a lower-quality intermediate without changing the native region', () => {
		assert.deepEqual(resolvePassExecution({ resolutionScale: 0.5 }, 2160, 3840), {
			mode: 'scaled',
			region: { x: 0, y: 0, width: 2160, height: 3840 },
			targetWidth: 1080,
			targetHeight: 1920
		});
	});

	it('rejects ambiguous local and scaled execution', () => {
		assert.throws(
			() =>
				resolvePassExecution(
					{ region: { x: 0, y: 0, width: 10, height: 10 }, resolutionScale: 0.5 },
					100,
					100
				),
			/cannot combine/
		);
	});
});
