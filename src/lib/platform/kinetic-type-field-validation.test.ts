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
});
