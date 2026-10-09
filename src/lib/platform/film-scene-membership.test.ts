import { describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { filmToWireFormat, parseFilmIngress } from './film-ingress';
import type { Film, FilmScene } from './film-schema';
import {
	insertFilmScene,
	mintFilmSceneId,
	moveFilmScene,
	removeFilmScene
} from './film-scene-membership';
import { parsePresetIngress } from './preset-ingress';
import { cloneJsonValue } from '../utils/json-clone';

const blank = parsePresetIngress(blankPresetJson);

function scene(id: string): FilmScene {
	return { id, origin: null, state: cloneJsonValue(blank.state) };
}

function film(sceneIds: readonly string[]): Film {
	return {
		schema: 'gfx-film@1',
		name: 'Launch film',
		pack: blank.pack,
		orientation: 'horizontal',
		fps: 30,
		format: 'webm',
		scenes: sceneIds.map(scene),
		boundaries: sceneIds.slice(1).map(() => ({ kind: 'cut' }))
	};
}

function sceneIds(subject: Film): string[] {
	return subject.scenes.map((entry) => entry.id);
}

/**
 * Tag each boundary with the pair it sat between when the Film was made, so a
 * test can say which boundary an edit kept. The tag is not a Film field; these
 * Films are never parsed.
 */
function tagBoundaries(subject: Film): Film {
	subject.boundaries = subject.boundaries.map((boundary, boundaryIndex) => ({
		...boundary,
		between: `${subject.scenes[boundaryIndex].id}>${subject.scenes[boundaryIndex + 1].id}`
	}));
	return subject;
}

function boundaryTags(subject: Film): (string | undefined)[] {
	return subject.boundaries.map(
		(boundary) => Reflect.get(boundary, 'between') as string | undefined
	);
}

describe('mintFilmSceneId', () => {
	it('numbers the next Scene one past the Scenes the Film holds', () => {
		expect(mintFilmSceneId(film(['scene-1']))).toBe('scene-2');
		expect(mintFilmSceneId(film(['scene-1', 'scene-2']))).toBe('scene-3');
	});

	it('steps past an id the Film already uses', () => {
		expect(mintFilmSceneId(film(['scene-1', 'scene-3']))).toBe('scene-4');
		expect(mintFilmSceneId(film(['intro', 'scene-3', 'outro', 'scene-4']))).toBe('scene-5');
	});
});

describe('insertFilmScene', () => {
	it('adds a Scene last with a cut before it, and keeps a Film the schema accepts', () => {
		const subject = film(['a', 'b']);

		insertFilmScene(subject, scene('c'), 2);

		expect(sceneIds(subject)).toEqual(['a', 'b', 'c']);
		expect(subject.boundaries).toEqual([{ kind: 'cut' }, { kind: 'cut' }]);
		expect(() => parseFilmIngress(filmToWireFormat(subject))).not.toThrow();
	});

	it('gives a Scene added in the middle a new boundary on its leading side', () => {
		const subject = tagBoundaries(film(['a', 'b', 'c']));

		insertFilmScene(subject, scene('n'), 1);

		expect(sceneIds(subject)).toEqual(['a', 'n', 'b', 'c']);
		// a>n is the new cut; the boundary that led into b still does.
		expect(boundaryTags(subject)).toEqual([undefined, 'a>b', 'b>c']);
	});

	it('gives a Scene added first its boundary on the trailing side', () => {
		const subject = tagBoundaries(film(['a', 'b']));

		insertFilmScene(subject, scene('n'), 0);

		expect(sceneIds(subject)).toEqual(['n', 'a', 'b']);
		expect(boundaryTags(subject)).toEqual([undefined, 'a>b']);
	});

	it('refuses an index outside the Film', () => {
		const subject = film(['a']);

		expect(() => insertFilmScene(subject, scene('n'), 2)).toThrow(RangeError);
		expect(() => insertFilmScene(subject, scene('n'), -1)).toThrow(RangeError);
		expect(() => insertFilmScene(subject, scene('n'), 0.5)).toThrow(RangeError);
		expect(sceneIds(subject)).toEqual(['a']);
	});
});

describe('removeFilmScene', () => {
	it('drops the boundary on the removed Scene’s leading side', () => {
		const subject = tagBoundaries(film(['a', 'b', 'c']));

		expect(removeFilmScene(subject, 'b')).toBe(1);

		expect(sceneIds(subject)).toEqual(['a', 'c']);
		expect(boundaryTags(subject)).toEqual(['b>c']);
	});

	it('drops the trailing boundary when the first Scene goes', () => {
		const subject = tagBoundaries(film(['a', 'b', 'c']));

		expect(removeFilmScene(subject, 'a')).toBe(0);

		expect(sceneIds(subject)).toEqual(['b', 'c']);
		expect(boundaryTags(subject)).toEqual(['b>c']);
	});

	it('is the inverse of adding the same Scene back', () => {
		const subject = tagBoundaries(film(['a', 'b', 'c']));
		const before = boundaryTags(subject).length;

		insertFilmScene(subject, scene('n'), 2);
		removeFilmScene(subject, 'n');

		expect(sceneIds(subject)).toEqual(['a', 'b', 'c']);
		expect(boundaryTags(subject)).toEqual(['a>b', 'b>c']);
		expect(subject.boundaries).toHaveLength(before);
	});

	it('refuses the last remaining Scene and a Scene the Film does not hold', () => {
		const subject = film(['a']);

		expect(() => removeFilmScene(subject, 'a')).toThrow(RangeError);
		expect(() => removeFilmScene(film(['a', 'b']), 'z')).toThrow(RangeError);
		expect(sceneIds(subject)).toEqual(['a']);
	});
});

describe('moveFilmScene', () => {
	it('moves a Scene to its new index and leaves the boundary list alone', () => {
		const subject = tagBoundaries(film(['a', 'b', 'c']));

		moveFilmScene(subject, 'a', 2);

		expect(sceneIds(subject)).toEqual(['b', 'c', 'a']);
		// Kinds stay by position: the first boundary is still the first.
		expect(boundaryTags(subject)).toEqual(['a>b', 'b>c']);

		moveFilmScene(subject, 'a', 0);
		expect(sceneIds(subject)).toEqual(['a', 'b', 'c']);
	});

	it('refuses an unknown Scene and an index outside the Film', () => {
		const subject = film(['a', 'b']);

		expect(() => moveFilmScene(subject, 'z', 0)).toThrow(RangeError);
		expect(() => moveFilmScene(subject, 'a', 2)).toThrow(RangeError);
		expect(() => moveFilmScene(subject, 'a', -1)).toThrow(RangeError);
		expect(sceneIds(subject)).toEqual(['a', 'b']);
	});
});
