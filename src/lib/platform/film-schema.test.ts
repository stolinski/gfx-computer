import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { MotionBeatIdSchema } from './engine-schema';
import {
	FILM_DURATION_CEILING_SECONDS,
	FILM_SCENE_LIMIT,
	FILM_SCHEMA_ID,
	FilmSceneIdSchema,
	FilmSchema,
	createFilmFormatJsonSchema,
	listFilmStructureIssues
} from './film-schema';

function sceneDocument(id: string): Record<string, unknown> {
	return { id, origin: null, state: blankPresetJson.state };
}

function filmDocument(sceneIds: readonly string[]): Record<string, unknown> {
	return {
		schema: FILM_SCHEMA_ID,
		name: 'Launch film',
		pack: 'syntax',
		orientation: 'horizontal',
		fps: 30,
		format: 'webm',
		scenes: sceneIds.map(sceneDocument),
		boundaries: sceneIds.slice(1).map(() => ({ kind: 'cut' }))
	};
}

function issueMessagesAt(document: unknown, path: string): string[] {
	const result = FilmSchema.safeParse(document);
	if (result.success) return [];
	return result.error.issues
		.filter((issue) => issue.path.join('/') === path)
		.map((issue) => issue.message);
}

describe('FilmSchema', () => {
	it('accepts a one-Scene Film with no boundaries', () => {
		const film = FilmSchema.parse(filmDocument(['intro']));

		assert.equal(film.schema, 'gfx-film@1');
		assert.equal(film.scenes.length, 1);
		assert.equal(film.scenes[0].origin, null);
		assert.deepEqual(film.boundaries, []);
	});

	it('accepts a three-Scene Film with a cut between each pair of neighbours', () => {
		const document = filmDocument(['intro', 'proof', 'outro']);
		document['description'] = 'Three ideas in a row.';
		document['scenes'] = [
			{ ...sceneDocument('intro'), origin: { slug: 'blank', contentKey: '0123456789abcdef' } },
			sceneDocument('proof'),
			sceneDocument('outro')
		];

		const film = FilmSchema.parse(document);

		assert.deepEqual(
			film.scenes.map((scene) => scene.id),
			['intro', 'proof', 'outro']
		);
		assert.deepEqual(film.scenes[0].origin, { slug: 'blank', contentKey: '0123456789abcdef' });
		assert.deepEqual(film.boundaries, [{ kind: 'cut' }, { kind: 'cut' }]);
	});

	it('refuses a boundary list that is not one per pair of neighbours', () => {
		const tooFew = { ...filmDocument(['intro', 'proof', 'outro']), boundaries: [{ kind: 'cut' }] };
		const tooMany = { ...filmDocument(['intro']), boundaries: [{ kind: 'cut' }] };

		assert.deepEqual(issueMessagesAt(tooFew, 'boundaries'), [
			'A Film with 3 Scenes has exactly 2 Scene boundaries, one per pair of neighbours; found 1.'
		]);
		assert.deepEqual(issueMessagesAt(tooMany, 'boundaries'), [
			'A Film with 1 Scene has exactly 0 Scene boundaries, one per pair of neighbours; found 1.'
		]);
	});

	it('refuses two Scenes with the same id, at the second one', () => {
		assert.deepEqual(issueMessagesAt(filmDocument(['intro', 'proof', 'intro']), 'scenes/2/id'), [
			'Duplicate Scene id "intro"; ids must be unique within a Film.'
		]);
	});

	it('refuses an unknown key at every level the Film owns', () => {
		const base = filmDocument(['intro', 'outro']);
		const unknownKeyDocuments: unknown[] = [
			{ ...base, score: { tempo: 120 } },
			{ ...base, kind: 'deliverable' },
			{ ...base, scenes: [{ ...sceneDocument('intro'), locked: true }, sceneDocument('outro')] },
			{
				...base,
				scenes: [
					{ ...sceneDocument('intro'), origin: { slug: 'blank', contentKey: 'k', version: 2 } },
					sceneDocument('outro')
				]
			},
			{
				...base,
				scenes: [
					{ ...sceneDocument('intro'), state: { ...blankPresetJson.state, sceneNotes: 'x' } },
					sceneDocument('outro')
				]
			},
			{ ...base, boundaries: [{ kind: 'cut', durationMs: 400 }] }
		];

		for (const document of unknownKeyDocuments) {
			assert.equal(FilmSchema.safeParse(document).success, false);
		}
	});

	it('refuses a boundary kind that is not registered', () => {
		const document = { ...filmDocument(['intro', 'outro']), boundaries: [{ kind: 'fade' }] };

		assert.equal(FilmSchema.safeParse(document).success, false);
	});

	it('refuses a Film with no Scenes, a missing origin, or another schema id', () => {
		const withoutOrigin = filmDocument(['intro']);
		withoutOrigin['scenes'] = [{ id: 'intro', state: blankPresetJson.state }];

		assert.equal(FilmSchema.safeParse(filmDocument([])).success, false);
		assert.equal(FilmSchema.safeParse(withoutOrigin).success, false);
		assert.equal(
			FilmSchema.safeParse({ ...filmDocument(['intro']), schema: 'gfx@1' }).success,
			false
		);
	});

	it('takes the transport rates, orientations, and formats a Scene transport takes', () => {
		const base = filmDocument(['intro']);

		for (const fps of [1, 24, 29.97, 59.94, 120]) {
			assert.equal(FilmSchema.safeParse({ ...base, fps }).success, true, `fps ${fps}`);
		}
		for (const fps of [0, 29.98, 121, 23.98]) {
			assert.equal(FilmSchema.safeParse({ ...base, fps }).success, false, `fps ${fps}`);
		}
		assert.equal(FilmSchema.safeParse({ ...base, orientation: 'vertical' }).success, true);
		assert.equal(FilmSchema.safeParse({ ...base, orientation: 'square' }).success, false);
		assert.equal(FilmSchema.safeParse({ ...base, format: 'prores' }).success, true);
		assert.equal(FilmSchema.safeParse({ ...base, format: 'gif' }).success, false);
		assert.equal(FilmSchema.safeParse({ ...base, pack: '' }).success, false);
	});

	it(`holds at most ${FILM_SCENE_LIMIT} Scenes`, () => {
		const sceneIds = (count: number): string[] =>
			Array.from({ length: count }, (_, index) => `scene-${index + 1}`);

		assert.equal(FilmSchema.safeParse(filmDocument(sceneIds(FILM_SCENE_LIMIT))).success, true);
		assert.equal(FilmSchema.safeParse(filmDocument(sceneIds(FILM_SCENE_LIMIT + 1))).success, false);
	});
});

describe('FilmSceneIdSchema', () => {
	it('accepts and refuses exactly what a Motion Beat id does', () => {
		const candidates = [
			'intro',
			'scene-1',
			'1',
			'a'.repeat(40),
			'a'.repeat(41),
			'',
			'-intro',
			'Intro',
			'scene_1',
			'scene 1',
			'scene/1',
			'scene.1'
		];

		for (const candidate of candidates) {
			assert.equal(
				FilmSceneIdSchema.safeParse(candidate).success,
				MotionBeatIdSchema.safeParse(candidate).success,
				`"${candidate}"`
			);
		}
		assert.equal(FilmSceneIdSchema.safeParse('scene-1').success, true);
		assert.equal(FilmSceneIdSchema.safeParse('Scene 1').success, false);
	});
});

describe('listFilmStructureIssues', () => {
	it('finds nothing wrong with a well-formed Film', () => {
		assert.deepEqual(
			listFilmStructureIssues({
				scenes: [{ id: 'a' }, { id: 'b' }],
				boundaries: [{ kind: 'cut' }]
			}),
			[]
		);
	});

	it('reports every duplicate id and a wrong boundary count together', () => {
		const issues = listFilmStructureIssues({
			scenes: [{ id: 'a' }, { id: 'a' }, { id: 'a' }],
			boundaries: []
		});

		assert.deepEqual(
			issues.map((issue) => issue.path),
			[['scenes', 1, 'id'], ['scenes', 2, 'id'], ['boundaries']]
		);
	});
});

describe('the Film duration ceiling', () => {
	it('is the ceiling one composition has', () => {
		assert.equal(FILM_DURATION_CEILING_SECONDS, 600);
	});
});

describe('docs/film-format.schema.json', () => {
	it('is the current output of `pnpm gen:schema`', () => {
		const committed = readFileSync(
			new URL('../../../docs/film-format.schema.json', import.meta.url),
			'utf8'
		);

		assert.equal(
			committed,
			`${JSON.stringify(createFilmFormatJsonSchema(), null, 2)}\n`,
			'docs/film-format.schema.json is stale; run `pnpm gen:schema`.'
		);
	});
});
