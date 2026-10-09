import { z } from 'zod';

import { EngineStateSchema, PresetSchema, type EngineState } from './engine-schema.ts';

/**
 * The Film wire format id (ADR-0068 §1). A Film is read and opened, not yet
 * written: both User composition stores accept a stored `{ meta, film }` record
 * (`./user-composition-record.ts`), and the document open in the Workspace is a
 * one-Scene Film (`./film-state.svelte.ts`). Every store write still saves a
 * Preset. Ingress is `./film-ingress.ts`; frame maths is `./film-playhead.ts`.
 */
export const FILM_SCHEMA_ID = 'gfx-film@1' as const;

// The Film's transport fields are the transport's own field schemas, read off
// `EngineStateSchema` so a Film can never accept a rate, orientation, or format
// a Scene's transport would refuse.
const SceneTransportShape = EngineStateSchema.shape.transport.shape;

function readFilmDurationCeilingSeconds(): number {
	const ceiling = SceneTransportShape.durationSeconds.maxValue;
	if (ceiling === null) {
		throw new Error('transport.durationSeconds declares no maximum to bound a Film by.');
	}
	return ceiling;
}

/**
 * The longest a whole Film may run (ADR-0068 §9): the transport's own ceiling
 * for one composition, read off the schema instead of restated, applied to the
 * sum of the Film's Scenes.
 */
export const FILM_DURATION_CEILING_SECONDS = readFilmDurationCeilingSeconds();

/**
 * The most Scenes one Film holds. Every Scene carries a complete engine state,
 * so this bounds the size of a Film document and the cost of validating it. 200
 * is more than ten times the 15 Scenes of the reference film ADR-0068 was
 * planned from, and averages three seconds a Scene at the 600-second ceiling.
 */
export const FILM_SCENE_LIMIT = 200;

// The same format as a Motion Beat id (`MotionBeatIdSchema`): lowercase
// letters, digits, and hyphens, at most 40 characters. A Scene id is written
// into operation receipts as `sceneId` (ADR-0068 §8) and is kept safe to put in
// a path. Declared here rather than reused so a refused id is reported as a
// Scene id; `film-schema.test.ts` holds the two formats together.
export const FilmSceneIdSchema = z
	.string()
	.regex(/^[a-z0-9][a-z0-9-]*$/, 'A Scene id is lowercase letters, digits, and hyphens.')
	.max(40);

/**
 * Where a Scene was seeded from (ADR-0068 §2): the source Preset's slug and
 * the content key its poster used when the Scene was made (ADR-0061). A record
 * of the past only. Nothing links back, and nothing re-syncs.
 *
 * `contentKey` is `null` for a Scene lifted from a legacy `{ meta, preset }`
 * stored record (`user-composition-record.ts`): that record kept the slug it
 * was forked from and never knew its source's content key. Required, so a
 * writer states which.
 */
export const FilmSceneOriginSchema = z.strictObject({
	slug: z.string().min(1),
	contentKey: z.string().min(1).nullable()
});

export const FilmSceneSchema = z.strictObject({
	id: FilmSceneIdSchema,
	// What the Scene strip calls the Scene. Optional: a Scene stored before names
	// existed has none, and `filmSceneDisplayName` (`./film-scene-display-name.ts`)
	// says what is shown for it. When present it is not empty, as a Film's name is.
	name: z.string().min(1, 'A Scene name is not empty').optional(),
	// `null` for a Scene started blank. Required, so a writer states which.
	origin: FilmSceneOriginSchema.nullable(),
	state: EngineStateSchema
});

/**
 * What happens between two neighbouring Scenes (ADR-0068 §4), discriminated on
 * `kind`. Only the hard cut exists today. Fade, the registered transition
 * effects, and magic move each arrive as one more member of this union, so
 * adding one never changes a Film that does not use it.
 */
export const FilmSceneBoundarySchema = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('cut') })
]);

/** One structural defect in a Film, in the shape Preset validation reports. */
export interface FilmStructureIssue {
	path: (string | number)[];
	message: string;
}

/**
 * The two rules that tie a Film's lists together: Scene ids are unique, and
 * there is exactly one boundary per pair of neighbouring Scenes. `FilmSchema`
 * runs this at parse time and `validateFilmSemantics` runs it again on a Film
 * edited in memory, so the rule has one definition.
 */
export function listFilmStructureIssues(film: {
	scenes: readonly { id: string }[];
	boundaries: readonly unknown[];
}): FilmStructureIssue[] {
	const issues: FilmStructureIssue[] = [];
	const seenSceneIds = new Set<string>();
	for (const [sceneIndex, scene] of film.scenes.entries()) {
		if (seenSceneIds.has(scene.id)) {
			issues.push({
				path: ['scenes', sceneIndex, 'id'],
				message: `Duplicate Scene id "${scene.id}"; ids must be unique within a Film.`
			});
		}
		seenSceneIds.add(scene.id);
	}
	const expectedBoundaryCount = Math.max(0, film.scenes.length - 1);
	if (film.boundaries.length !== expectedBoundaryCount) {
		issues.push({
			path: ['boundaries'],
			message: `A Film with ${film.scenes.length} Scene${film.scenes.length === 1 ? '' : 's'} has exactly ${expectedBoundaryCount} Scene ${expectedBoundaryCount === 1 ? 'boundary' : 'boundaries'}, one per pair of neighbours; found ${film.boundaries.length}.`
		});
	}
	return issues;
}

/**
 * The canonical `gfx-film@1` document (ADR-0068 §1–2) and the source of
 * `docs/film-format.schema.json`. Strict at every level it owns: an unknown
 * key is refused, never dropped.
 *
 * `orientation`, `fps`, and `format` are the one transport of the whole Film.
 * Each Scene's `state.transport` still carries them, so a Scene state is a
 * complete `EngineState` on its own; `FilmIngressSchema` stamps the Film's
 * values over them. There is no `score` field yet (ADR-0068 §6).
 */
export const FilmSchema = z
	.strictObject({
		schema: z.literal(FILM_SCHEMA_ID),
		name: z.string().min(1, 'Film name is required'),
		description: z.string().optional(),
		// One Pack for the whole Film, with the Preset's own rule (ADR-0023:
		// no privileged default Pack).
		pack: PresetSchema.shape.pack,
		orientation: SceneTransportShape.orientation,
		fps: SceneTransportShape.fps,
		format: SceneTransportShape.format,
		scenes: z.array(FilmSceneSchema).min(1, 'A Film has at least one Scene').max(FILM_SCENE_LIMIT),
		boundaries: z.array(FilmSceneBoundarySchema).max(FILM_SCENE_LIMIT - 1)
	})
	.superRefine((film, ctx) => {
		for (const issue of listFilmStructureIssues(film)) {
			ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
		}
	});

export type FilmSceneOrigin = z.infer<typeof FilmSceneOriginSchema>;
export type FilmSceneBoundary = z.infer<typeof FilmSceneBoundarySchema>;
// `state` is named as `EngineState` rather than left as the inferred shape, the
// same way `Preset` names it, so a Scene state is assignable wherever an engine
// state is expected.
export type FilmScene = Omit<z.infer<typeof FilmSceneSchema>, 'state'> & { state: EngineState };
export type Film = Omit<z.infer<typeof FilmSchema>, 'scenes'> & { scenes: FilmScene[] };

/**
 * The JSON Schema for the `gfx-film@1` wire format, as written to
 * `docs/film-format.schema.json` by `scripts/export-film-schema.ts`.
 * `film-schema.test.ts` holds the committed file to this output.
 */
export function createFilmFormatJsonSchema(): Record<string, unknown> {
	return {
		$id: FILM_SCHEMA_ID,
		...z.toJSONSchema(FilmSchema, { target: 'draft-2020-12', io: 'input' })
	};
}
