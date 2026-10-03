import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { parseAnnotationBodyText } from '$lib/annotations/annotation-body-text';
import type { KineticTypeField, SurfaceState } from './engine-schema';
import { validateKineticTypeFieldSemantics } from './kinetic-type-field-validation';

function field(): KineticTypeField {
	return {
		words: [
			{
				type: 'kinetic-word',
				id: 'type',
				text: 'TYPE',
				hierarchy: 'display',
				ink: 'accent',
				position: { x: 0.5, y: 0.4 },
				scale: 1,
				rotation: 0
			}
		],
		phrases: [{ id: 'opening', wordIds: ['type'], focalWordId: 'type' }]
	};
}

function surface(typeField: KineticTypeField = field()): SurfaceState {
	return {
		type: 'plain',
		content: { body: parseAnnotationBodyText('') },
		typeField
	};
}

describe('validateKineticTypeFieldSemantics', () => {
	it('accepts a plain Surface field with a display focal word', () => {
		const current = surface();
		assert.deepEqual(validateKineticTypeFieldSemantics(current.typeField, current), []);
	});

	it('keeps the Type Field off the Dimensional Stage in v1', () => {
		const current = surface();
		const issues = validateKineticTypeFieldSemantics(current.typeField, current, true);
		assert.equal(issues[0]?.path.length, 0);
		assert.match(issues[0]?.message ?? '', /does not support the Dimensional Stage/);
	});

	it('keeps the Type Field on the plain Surface', () => {
		const current = surface();
		current.type = 'paper';
		const issues = validateKineticTypeFieldSemantics(current.typeField, current);
		assert.equal(issues[0]?.path.length, 0);
		assert.match(issues[0]?.message ?? '', /only on the plain Surface/);
	});

	it('enforces the shared Surface Block-id namespace', () => {
		const current = surface();
		current.diagram = [
			{
				type: 'label',
				id: 'type',
				text: 'collision',
				position: { x: 0.2, y: 0.2 }
			}
		];
		const issues = validateKineticTypeFieldSemantics(current.typeField, current);
		assert.deepEqual(issues[0]?.path, ['words', 0, 'id']);
		assert.match(issues[0]?.message ?? '', /duplicates another Block id/);
	});

	it('requires every phrase focal word to use display hierarchy', () => {
		const current = surface();
		current.typeField!.words[0].hierarchy = 'support';
		const issues = validateKineticTypeFieldSemantics(current.typeField, current);
		assert.deepEqual(issues[0]?.path, ['phrases', 0, 'focalWordId']);
		assert.match(issues[0]?.message ?? '', /must use display hierarchy/);
	});

	it('refuses a field past its keyframe, glyph-span, and critical-moment ceilings', () => {
		const words = Array.from({ length: 14 }, (_, index) => ({
			...field().words[0],
			id: `word-${index}`,
			text: 'COMPOSITIONALLY',
			animation: {
				channels: {
					reveal: Array.from({ length: 24 }, (_, frame) => ({
						atMs: frame * 100,
						value: Math.floor((frame + 1) / 2) % 2 === 0 ? -1 : 0
					}))
				}
			}
		}));
		const crowded: KineticTypeField = {
			words,
			phrases: [{ id: 'opening', wordIds: ['word-0'], focalWordId: 'word-0' }]
		};
		const messages = validateKineticTypeFieldSemantics(crowded, surface(crowded)).map(
			(issue) => issue.message
		);
		assert.ok(messages.some((message) => /336 keyframes/.test(message)));
		assert.ok(messages.some((message) => /210 glyph spans/.test(message)));
		assert.ok(messages.some((message) => /critical moments/.test(message)));
	});

	it('requires every word of a beat-bound phrase to read at its beat', () => {
		const hidden = field();
		hidden.words[0].animation = {
			channels: {
				reveal: [
					{ atMs: 0, value: -1 },
					{ atMs: 1000, value: 0, ease: 'sharp' }
				]
			}
		};
		hidden.phrases[0].beatId = 'early';
		const issues = validateKineticTypeFieldSemantics(hidden, surface(hidden), false, [
			{ id: 'early', atMs: 500 }
		]);
		assert.match(issues[0]?.message ?? '', /must read at Motion Beat "early"/);
		assert.deepEqual(
			validateKineticTypeFieldSemantics(hidden, surface(hidden), false, [
				{ id: 'early', atMs: 1000 }
			]),
			[]
		);
	});
});
