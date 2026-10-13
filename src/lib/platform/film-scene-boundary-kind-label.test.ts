import { describe, expect, it } from 'vite-plus/test';

import { filmSceneBoundaryKindLabel } from './film-scene-boundary-kind-label';
import { FILM_SCENE_BOUNDARY_KINDS } from './film-schema';
import { transitionEffectDefinitions } from './pipelines/transition-definition-registry';

describe('filmSceneBoundaryKindLabel', () => {
	it('names a cut and a fade', () => {
		expect(filmSceneBoundaryKindLabel('cut')).toBe('Cut');
		expect(filmSceneBoundaryKindLabel('fade')).toBe('Fade');
	});

	it.each(transitionEffectDefinitions())('names $type by the effect own label', (definition) => {
		const kind = FILM_SCENE_BOUNDARY_KINDS.find((candidate) => candidate === definition.type);
		if (kind === undefined) throw new Error(`${definition.type} is not a boundary kind.`);

		expect(filmSceneBoundaryKindLabel(kind)).toBe(definition.label);
	});

	it('gives every kind a label of its own', () => {
		const labels = FILM_SCENE_BOUNDARY_KINDS.map(filmSceneBoundaryKindLabel);

		expect(new Set(labels).size).toBe(FILM_SCENE_BOUNDARY_KINDS.length);
		expect(labels.every((label) => label.length > 0)).toBe(true);
	});
});
