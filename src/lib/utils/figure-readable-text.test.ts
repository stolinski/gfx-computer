import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { FigureSchema } from '$lib/platform/engine-schema';
import { FIGURE_TARGET_DECLARATIONS } from '$lib/platform/figure-target-declarations.fixture';

import { figureReadableTextId, resolveFigureReadableText } from './figure-readable-text';

// The layout contract's domain-id format (ADR-0050) that every readable id meets.
const DOMAIN_ID = /^[a-z0-9][a-z0-9._:-]{0,255}$/;

describe('figureReadableTextId', () => {
	it('maps the scene key structure into the domain-id format', () => {
		assert.equal(figureReadableTextId('flows', 'link:a>b#value'), 'block:flows:link:a:to:b:value');
		assert.equal(figureReadableTextId('tree', 'node:pie#label-1'), 'block:tree:node:pie:label-1');
	});

	it('gives every target Figure readable ids the layout contract accepts', () => {
		for (const declaration of Object.values(FIGURE_TARGET_DECLARATIONS)) {
			const figure = FigureSchema.parse(declaration);
			for (const orientation of ['horizontal', 'vertical'] as const) {
				const ids = resolveFigureReadableText(figure, orientation, 0.6, 6000).map(
					(text) => text.id
				);
				assert.ok(ids.length > 0, `${figure.kind} has readable text`);
				for (const id of ids) assert.match(id, DOMAIN_ID, `${figure.kind} ${orientation}: ${id}`);
				assert.equal(new Set(ids).size, ids.length, `${figure.kind} ids are unique`);
			}
		}
	});
});
