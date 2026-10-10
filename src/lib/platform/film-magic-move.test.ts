import { describe, expect, it } from 'vitest';

import twoSceneMagicMoveFilmJson from '../../../scripts/fixtures/film-magic-move/two-scene-magic-move.film.json';

import { parseFilm, validateFilmSemantics } from './film-ingress';
import {
	listFilmMagicMoveIssues,
	listFilmMagicMovePairChoices,
	suggestFilmMagicMovePairs
} from './film-magic-move';
import {
	FILM_MAGIC_MOVE_DEFAULT_EASE,
	FILM_MAGIC_MOVE_ELEMENT_KINDS,
	FILM_MAGIC_MOVE_PAIR_LIMIT,
	FilmSceneBoundarySchema,
	type Film,
	type FilmMagicMovePair
} from './film-schema';
import { getOverlayDefinition } from './pipelines/definition-registry';
import { cloneJsonValue } from '../utils/json-clone';

import type { Overlay } from './engine-schema';

const LOWER_THIRD_PAIR: FilmMagicMovePair = {
	from: { kind: 'overlay', id: 'lower-third' },
	to: { kind: 'overlay', id: 'lower-third' }
};

/** The fixture Film: two opaque Scenes sharing the Overlay `lower-third`, a fade carrying it. */
function magicMoveFilm(): Film {
	return parseFilm(cloneJsonValue(twoSceneMagicMoveFilmJson));
}

function overlayOf(film: Film, sceneIndex: number, id = 'lower-third'): Overlay {
	const overlay = film.scenes[sceneIndex].state.overlays.find((candidate) => candidate.id === id);
	if (!overlay) throw new Error(`Scene ${sceneIndex} has no Overlay "${id}".`);
	return overlay;
}

function setPairs(film: Film, pairs: FilmMagicMovePair[]): void {
	const boundary = film.boundaries[0];
	if (boundary.kind === 'cut') throw new Error('The fixture boundary is a fade.');
	boundary.magicMove = { pairs };
}

function pathsOf(film: Film): string[] {
	return listFilmMagicMoveIssues(film).map((issue) => issue.path.join('/'));
}

describe('the magic move of a Scene boundary, as the Film format holds it', () => {
	it('is carried by a fade and by every transition effect, with an optional ease', () => {
		const magicMove = { pairs: [LOWER_THIRD_PAIR], ease: 'settled' };

		expect(FilmSceneBoundarySchema.parse({ kind: 'fade', durationMs: 1000, magicMove })).toEqual({
			kind: 'fade',
			durationMs: 1000,
			magicMove
		});
		const wipe = FilmSceneBoundarySchema.parse({
			kind: 'mask-wipe',
			durationMs: 800,
			params: { direction: 'right', softness: 0.001 },
			magicMove: { pairs: [LOWER_THIRD_PAIR] }
		});
		expect(wipe).toMatchObject({ kind: 'mask-wipe', magicMove: { pairs: [LOWER_THIRD_PAIR] } });
		// No ease is written for a boundary that states none; `smooth` is read for it.
		expect(wipe).not.toHaveProperty('magicMove.ease');
		expect(FILM_MAGIC_MOVE_DEFAULT_EASE).toBe('smooth');
	});

	it('is refused on a cut, which has no window', () => {
		expect(
			FilmSceneBoundarySchema.safeParse({ kind: 'cut', magicMove: { pairs: [LOWER_THIRD_PAIR] } })
				.success
		).toBe(false);
	});

	it('refuses an empty pair list, too many pairs, an unknown ease, kind, or key', () => {
		const parse = (magicMove: unknown): boolean =>
			FilmSceneBoundarySchema.safeParse({ kind: 'fade', durationMs: 1000, magicMove }).success;

		expect(parse({ pairs: [] })).toBe(false);
		expect(
			parse({
				pairs: Array.from({ length: FILM_MAGIC_MOVE_PAIR_LIMIT + 1 }, (_unused, index) => ({
					from: { kind: 'overlay', id: `a-${index}` },
					to: { kind: 'overlay', id: `b-${index}` }
				}))
			})
		).toBe(false);
		expect(parse({ pairs: [LOWER_THIRD_PAIR], ease: 'ease-in-out' })).toBe(false);
		expect(
			parse({ pairs: [{ from: { kind: 'diagram-node', id: 'a' }, to: LOWER_THIRD_PAIR.to }] })
		).toBe(false);
		expect(parse({ pairs: [{ ...LOWER_THIRD_PAIR, ease: 'smooth' }] })).toBe(false);
		expect(parse({ pairs: [{ from: { kind: 'overlay', id: '' }, to: LOWER_THIRD_PAIR.to }] })).toBe(
			false
		);
		// Overlays are the one kind built; later kinds are added to this list.
		expect(FILM_MAGIC_MOVE_ELEMENT_KINDS).toEqual(['overlay']);
	});
});

describe('which pairs a Film can carry', () => {
	it('accepts the fixture Film: one Overlay, the same type and id in both Scenes', () => {
		const film = magicMoveFilm();

		expect(listFilmMagicMoveIssues(film)).toEqual([]);
		expect(validateFilmSemantics(film)).toEqual([]);
	});

	it('refuses an id a Scene does not hold, at that end of the pair, naming what it holds', () => {
		const film = magicMoveFilm();
		setPairs(film, [
			{ from: { kind: 'overlay', id: 'missing' }, to: { kind: 'overlay', id: 'gone' } }
		]);

		const issues = listFilmMagicMoveIssues(film);

		expect(issues.map((issue) => issue.path.join('/'))).toEqual([
			'boundaries/0/magicMove/pairs/0/from/id',
			'boundaries/0/magicMove/pairs/0/to/id'
		]);
		expect(issues[0].message).toContain('Scene "outro" has no Overlay with id "missing"');
		expect(issues[0].message).toContain('lower-third');
		expect(issues[1].message).toContain('Scene "brand-mark" has no Overlay with id "gone"');
		// The finding is part of what makes the Film one the engine cannot open.
		expect(validateFilmSemantics(film).map((issue) => issue.path.join('/'))).toEqual(
			issues.map((issue) => issue.path.join('/'))
		);
	});

	it('refuses an element in two pairs of one boundary, at the later pair', () => {
		const film = magicMoveFilm();
		const second = cloneJsonValue(overlayOf(film, 1));
		second.id = 'second';
		film.scenes[1].state.overlays.push(second);
		setPairs(film, [
			LOWER_THIRD_PAIR,
			{ from: { kind: 'overlay', id: 'lower-third' }, to: { kind: 'overlay', id: 'second' } }
		]);

		const issues = listFilmMagicMoveIssues(film);

		expect(issues.map((issue) => issue.path.join('/'))).toEqual([
			'boundaries/0/magicMove/pairs/1/from/id'
		]);
		expect(issues[0].message).toContain('already carried');
	});

	it('refuses two Overlays of different types, at the pair', () => {
		const film = magicMoveFilm();
		overlayOf(film, 1).type = 'watermark';
		expect(getOverlayDefinition('watermark')).not.toBeNull();

		const issues = listFilmMagicMoveIssues(film);

		expect(issues.map((issue) => issue.path.join('/'))).toEqual(['boundaries/0/magicMove/pairs/0']);
		expect(issues[0].message).toContain('lower-third');
		expect(issues[0].message).toContain('watermark');
	});

	it('refuses an Overlay that is drawn by its own shader pass, at that end', () => {
		const film = magicMoveFilm();
		overlayOf(film, 0).type = 'shader-fill';
		overlayOf(film, 1).type = 'shader-fill';

		const issues = listFilmMagicMoveIssues(film);

		expect(issues.map((issue) => issue.path.join('/'))).toEqual([
			'boundaries/0/magicMove/pairs/0/from/id',
			'boundaries/0/magicMove/pairs/0/to/id'
		]);
		expect(issues[0].message).toContain('its own shader pass');
	});

	it('refuses every Overlay of a Scene with a depth stage, at that end', () => {
		const film = magicMoveFilm();
		film.scenes[1].state.stage = {
			type: 'depth'
		} as NonNullable<Film['scenes'][number]['state']['stage']>;

		const issues = listFilmMagicMoveIssues(film);

		expect(issues.map((issue) => issue.path.join('/'))).toEqual([
			'boundaries/0/magicMove/pairs/0/to/id'
		]);
		expect(issues[0].message).toContain('depth stage of Scene "brand-mark"');
	});

	it('finds nothing on a boundary without a magic move', () => {
		const film = magicMoveFilm();
		film.boundaries = [{ kind: 'fade', durationMs: 1000 }];

		expect(pathsOf(film)).toEqual([]);
	});
});

describe('the pairs a boundary suggests', () => {
	it('suggests every Overlay with the same id and type in both Scenes, in the outgoing order', () => {
		const film = magicMoveFilm();
		// A second shared Overlay, one only the outgoing Scene has, and one whose
		// partner is another type.
		for (const [id, inBoth, incomingType] of [
			['shared-watermark', true, 'watermark'],
			['outgoing-only', false, 'watermark'],
			['retyped', true, 'lower-third']
		] as const) {
			film.scenes[0].state.overlays.push({
				...cloneJsonValue(overlayOf(film, 0)),
				id,
				type: 'watermark'
			});
			if (inBoth) {
				film.scenes[1].state.overlays.unshift({
					...cloneJsonValue(overlayOf(film, 1)),
					id,
					type: incomingType
				});
			}
		}

		expect(suggestFilmMagicMovePairs(film, 0)).toEqual([
			LOWER_THIRD_PAIR,
			{
				from: { kind: 'overlay', id: 'shared-watermark' },
				to: { kind: 'overlay', id: 'shared-watermark' }
			}
		]);
	});

	it('suggests nothing a magic move would refuse', () => {
		const shaderFilm = magicMoveFilm();
		overlayOf(shaderFilm, 0).type = 'shader-fill';
		overlayOf(shaderFilm, 1).type = 'shader-fill';
		expect(suggestFilmMagicMovePairs(shaderFilm, 0)).toEqual([]);

		const stagedFilm = magicMoveFilm();
		stagedFilm.scenes[0].state.stage = {
			type: 'depth'
		} as NonNullable<Film['scenes'][number]['state']['stage']>;
		expect(suggestFilmMagicMovePairs(stagedFilm, 0)).toEqual([]);
	});

	it('throws for a boundary the Film does not have', () => {
		expect(() => suggestFilmMagicMovePairs(magicMoveFilm(), 1)).toThrow(RangeError);
	});
});

describe('the pairs the inspector lists', () => {
	it('names a pair for its Overlay type, and says whether the boundary carries it', () => {
		const film = magicMoveFilm();
		const label = getOverlayDefinition('lower-third')?.label;

		expect(listFilmMagicMovePairChoices(film, 0)).toEqual([
			{ pair: LOWER_THIRD_PAIR, label, isCarried: true }
		]);

		film.boundaries = [{ kind: 'fade', durationMs: 1000 }];
		expect(listFilmMagicMovePairChoices(film, 0)).toEqual([
			{ pair: LOWER_THIRD_PAIR, label, isCarried: false }
		]);
	});

	it('adds ids where two choices would read alike, and lists a carried pair of two ids', () => {
		const film = magicMoveFilm();
		const label = getOverlayDefinition('lower-third')?.label;
		film.scenes[0].state.overlays.push({ ...cloneJsonValue(overlayOf(film, 0)), id: 'speaker' });
		film.scenes[1].state.overlays.push({ ...cloneJsonValue(overlayOf(film, 1)), id: 'guest' });
		film.scenes[1].state.overlays.push({ ...cloneJsonValue(overlayOf(film, 1)), id: 'speaker' });
		const crossPair: FilmMagicMovePair = {
			from: { kind: 'overlay', id: 'speaker' },
			to: { kind: 'overlay', id: 'guest' }
		};
		setPairs(film, [crossPair]);

		expect(listFilmMagicMovePairChoices(film, 0)).toEqual([
			{ pair: crossPair, label: `${label} · speaker → guest`, isCarried: true },
			{ pair: LOWER_THIRD_PAIR, label: `${label} · lower-third`, isCarried: false },
			{
				pair: { from: { kind: 'overlay', id: 'speaker' }, to: { kind: 'overlay', id: 'speaker' } },
				label: `${label} · speaker`,
				isCarried: false
			}
		]);
	});

	it('offers none for a cut', () => {
		const film = magicMoveFilm();
		film.boundaries = [{ kind: 'cut' }];

		expect(listFilmMagicMovePairChoices(film, 0)).toEqual([]);
	});
});
