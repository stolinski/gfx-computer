import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { diagramNodeHighlightSpanAt } from './diagram-node-highlight';

describe('diagramNodeHighlightSpanAt', () => {
	const swipe = { start: 0.2, duration: 0.1, ease: 'smooth' as const };

	it('is empty before the swipe, draws on across its window, then holds', () => {
		assert.deepEqual(diagramNodeHighlightSpanAt(swipe, 0.1), { from: 0, to: 0 });
		const middle = diagramNodeHighlightSpanAt(swipe, 0.25);
		assert.ok(middle.to > 0 && middle.to < 1);
		assert.deepEqual(diagramNodeHighlightSpanAt(swipe, 0.9), { from: 0, to: 1 });
	});

	it('wipes off left to right over its lift', () => {
		const lifting = { ...swipe, lift: { start: 0.5, duration: 0.1, ease: 'smooth' as const } };
		assert.deepEqual(diagramNodeHighlightSpanAt(lifting, 0.45), { from: 0, to: 1 });
		const middle = diagramNodeHighlightSpanAt(lifting, 0.55);
		assert.ok(middle.from > 0 && middle.from < 1 && middle.to === 1);
		assert.deepEqual(diagramNodeHighlightSpanAt(lifting, 0.7), { from: 1, to: 1 });
	});

	it('keeps an overshooting ease inside the text', () => {
		const settled = { start: 0, duration: 1, ease: 'settled' as const };
		for (let step = 0; step <= 20; step += 1) {
			const span = diagramNodeHighlightSpanAt(settled, step / 20);
			assert.ok(span.to <= 1 && span.from >= 0);
		}
	});
});
