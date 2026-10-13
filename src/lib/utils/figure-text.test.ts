import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { formatFigureValue, measureFigureText } from './figure-text';

describe('formatFigureValue', () => {
	it('applies prefix, grouping, precision, compact, and suffix', () => {
		assert.equal(formatFigureValue(1348, { prefix: '$', suffix: 'B', precision: 0 }), '$1,348B');
		assert.equal(formatFigureValue(21.35, { prefix: '$', suffix: 'T', precision: 1 }), '$21.4T');
		assert.equal(formatFigureValue(12_400_000, { precision: 1, compact: true }), '12.4M');
		assert.equal(formatFigureValue(-3.2, { precision: 1 }), '−3.2');
	});
});

describe('measureFigureText', () => {
	it('scales the hero role well above a label', () => {
		const hero = measureFigureText('2020', 'hero', 'horizontal');
		const label = measureFigureText('2020', 'label', 'horizontal');
		assert.ok(hero.height > label.height * 2);
	});
});
