import { z } from 'zod';

import { PRESET_SCHEMA_ID, type EngineState, type Preset } from './engine-schema';
import { filmFrameCount } from './film-playhead';
import {
	FILM_DURATION_CEILING_SECONDS,
	FILM_SCHEMA_ID,
	FilmSchema,
	listFilmStructureIssues,
	type Film,
	type FilmScene,
	type FilmSceneOrigin
} from './film-schema';
import { engineStateToWireFormat } from './preset-pure';
import {
	formatPresetSemanticIssues,
	validatePresetSemantics,
	type PresetSemanticIssue,
	type PresetSemanticValidationOptions
} from './preset-validation';
import { resolveFrameRate, secondsToFrames } from '../utils/composition-timing';
import { cloneJsonValue } from '../utils/json-clone';
import { isRecord } from '../utils/object';

/** The id `filmFromPreset` gives the one Scene of the Film it makes. */
export const FILM_FIRST_SCENE_ID = 'scene-1';

/** The transport fields a Film states once for all of its Scenes (ADR-0068 §1). */
const FILM_TRANSPORT_FIELDS = ['orientation', 'fps', 'format'] as const;

type FilmTransport = Pick<Film, (typeof FILM_TRANSPORT_FIELDS)[number]>;

function hasOwn(value: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Write the Film's `orientation`, `fps`, and `format` into every Scene's
 * `state.transport` before the document is parsed.
 *
 * The Film's values are the truth. A Scene transport that leaves one of them
 * out, or states a different value, is not an error: the Film's value is
 * written over it. Running first means a stale Scene value can never fail the
 * parse on its own, and what `FilmSchema` then checks is the stamped document.
 * Only the three shared fields are touched; `durationSeconds` and
 * `posterSeconds` belong to the Scene.
 *
 * Anything that is not the expected shape passes through untouched so
 * `FilmSchema` reports it with its path.
 */
function stampFilmTransportIntoSceneInputs(input: unknown): unknown {
	if (!isRecord(input) || !Array.isArray(input['scenes'])) {
		return input;
	}
	const filmTransport: Record<string, unknown> = {};
	for (const field of FILM_TRANSPORT_FIELDS) {
		if (hasOwn(input, field)) {
			filmTransport[field] = input[field];
		}
	}
	const scenes = input['scenes'].map((scene: unknown): unknown => {
		if (!isRecord(scene) || !isRecord(scene['state']) || !isRecord(scene['state']['transport'])) {
			return scene;
		}
		return {
			...scene,
			state: {
				...scene['state'],
				transport: { ...scene['state']['transport'], ...filmTransport }
			}
		};
	});
	return { ...input, scenes };
}

/**
 * The one structural boundary for Film documents entering the engine.
 * `FilmSchema` stays canonical for JSON Schema generation; this boundary stamps
 * the Film's transport into each Scene, then hands every constraint and
 * transform to `FilmSchema`. After it, each Scene state is a complete, valid
 * `EngineState` on its own.
 */
export const FilmIngressSchema = z
	.unknown()
	.transform(stampFilmTransportIntoSceneInputs)
	.pipe(FilmSchema);

export function parseFilmIngress(value: unknown): Film {
	return FilmIngressSchema.parse(value);
}

function sceneStateUnderFilmTransport(filmTransport: FilmTransport, scene: FilmScene): EngineState {
	return {
		...scene.state,
		transport: {
			...scene.state.transport,
			orientation: filmTransport.orientation,
			fps: filmTransport.fps,
			format: filmTransport.format
		}
	};
}

/**
 * The engine state to apply when `sceneId` plays: the Scene's own state under
 * the Film's `orientation`, `fps`, and `format`.
 *
 * A parsed Film already has them stamped. They are written again here because
 * a Film edited in memory can change its transport without touching every
 * Scene, and the Film's value must still win. Throws a `RangeError` when the
 * Film has no Scene with that id.
 */
export function sceneStateForPlayback(film: Film, sceneId: string): EngineState {
	const scene = film.scenes.find((candidate) => candidate.id === sceneId);
	if (!scene) {
		throw new RangeError(`The Film has no Scene with id "${sceneId}".`);
	}
	return sceneStateUnderFilmTransport(film, scene);
}

/**
 * A one-Scene Film made from a Preset (ADR-0068 §1: a one-off piece is a Film
 * with one Scene). The Film takes the Preset's name, description, and Pack, and
 * its orientation, fps, and format from the Preset's transport. The Scene owns
 * a copy of the Preset's state, so later edits to either never reach the other.
 *
 * `origin` records the source: `{ slug, contentKey }` with the content key the
 * Preset's poster uses (`posterKeyForPreset`), or `null` for a Scene that did
 * not come from a catalogue Preset.
 *
 * Two Preset fields are not carried. `kind` classifies a catalogue entry and a
 * Film is not one. The legacy top-level `transition` recipe is dropped: a
 * transition Preset becomes a two-Scene Film in a later task (ADR-0068 §3),
 * which needs boundaries that are more than a hard cut.
 */
export function filmFromPreset(preset: Preset, origin: FilmSceneOrigin | null): Film {
	const film: Film = {
		schema: FILM_SCHEMA_ID,
		name: preset.name,
		pack: preset.pack,
		orientation: preset.state.transport.orientation,
		fps: preset.state.transport.fps,
		format: preset.state.transport.format,
		scenes: [
			{
				id: FILM_FIRST_SCENE_ID,
				origin: origin === null ? null : { ...origin },
				state: cloneJsonValue(preset.state)
			}
		],
		boundaries: []
	};
	if (preset.description !== undefined) film.description = preset.description;
	return film;
}

/**
 * The one-Scene Film a corpus Preset opens as, and a Starter is stored as:
 * `filmFromPreset`, with the Scene named for the Preset. The Film's name can
 * change afterwards; the Scene keeps the name of what it was seeded from.
 *
 * A legacy stored record is lifted with `filmFromPreset` itself and gains no
 * Scene name: reading a record never rewrites it.
 */
export function filmFromCorpusPreset(preset: Preset, origin: FilmSceneOrigin): Film {
	const film = filmFromPreset(preset, origin);
	return {
		...film,
		scenes: film.scenes.map((scene) => ({
			id: scene.id,
			name: preset.name,
			origin: scene.origin,
			state: scene.state
		}))
	};
}

/**
 * One Scene of a Film as the Preset it would be alone: the Film's name,
 * description, and Pack around a copy of the Scene's state under the Film's
 * transport. The inverse of `filmFromPreset` for that Scene.
 *
 * `kind` is `deliverable`. A Film does not carry the field, and `deliverable`
 * is the kind of user work (`PresetSchema` defaults to it). A Film holds no
 * `transition` recipe either, so the Preset has none. The Scene's `origin` is
 * not part of a Preset; a caller that needs it reads it off the Film.
 *
 * Throws a `RangeError` when the Film has no Scene with that id.
 */
export function presetFromFilmScene(film: Film, sceneId: string): Preset {
	return {
		schema: PRESET_SCHEMA_ID,
		name: film.name,
		...(film.description !== undefined ? { description: film.description } : {}),
		pack: film.pack,
		kind: 'deliverable',
		state: cloneJsonValue(sceneStateForPlayback(film, sceneId))
	};
}

/**
 * The Preset a one-Scene Film is (`presetFromFilmScene` of its only Scene), for
 * the one caller that can still write only one Preset: the legacy record shape
 * `userCompositionWriteShape` keeps for a two-endpoint transition.
 *
 * Throws a `RangeError` for any other number of Scenes: a longer Film is not
 * one Preset, and writing one Scene of it would drop the rest.
 */
export function presetFromSingleSceneFilm(film: Film): Preset {
	const [scene] = film.scenes;
	if (scene === undefined || film.scenes.length !== 1) {
		throw new RangeError(
			`The Film "${film.name}" has ${film.scenes.length} Scenes, so it is not one Preset.`
		);
	}
	return presetFromFilmScene(film, scene.id);
}

/**
 * Converts a Film to a JSON-serializable plain object, the way
 * `presetToWireFormat` does for a Preset. An in-memory Film holds parsed
 * annotation bodies in every Scene, exactly as a Preset does, so each Scene's
 * state is written through the same `engineStateToWireFormat` and
 * `FilmIngressSchema` can parse the result again without data loss.
 *
 * Each Scene is written under the Film's transport, so a Film edited in memory
 * never stores a Scene value its own `orientation`, `fps`, or `format`
 * overrides.
 */
export function filmToWireFormat(film: Film): unknown {
	return {
		...film,
		scenes: film.scenes.map((scene) => ({
			...scene,
			state: engineStateToWireFormat(sceneStateUnderFilmTransport(film, scene))
		}))
	};
}

/**
 * Registry and cross-domain checks for a parsed Film, in the shape Preset
 * validation reports (`PresetSemanticIssue`).
 *
 * Every Scene goes through `validatePresetSemantics` itself, as the Preset it
 * would be alone: the Film's Pack and transport around the Scene's state. Its
 * findings come back under `/scenes/<index>/state/...`. The Pack is one field
 * of the Film, so a Pack finding is reported once, at `/pack`.
 *
 * On top of that: Scene ids are unique, there is one boundary per pair of
 * neighbours, and the whole Film fits the duration ceiling, counted in frames.
 */
export function validateFilmSemantics(
	film: Film,
	options: PresetSemanticValidationOptions = {}
): readonly PresetSemanticIssue[] {
	const issues: PresetSemanticIssue[] = [];
	const structureIssues = listFilmStructureIssues(film);
	issues.push(...structureIssues);

	const reportedPackMessages = new Set<string>();
	for (const [sceneIndex, scene] of film.scenes.entries()) {
		const sceneAsPreset: Preset = {
			schema: PRESET_SCHEMA_ID,
			name: film.name,
			pack: film.pack,
			kind: 'deliverable',
			state: sceneStateUnderFilmTransport(film, scene)
		};
		for (const issue of validatePresetSemantics(sceneAsPreset, options)) {
			if (issue.path[0] === 'pack') {
				if (!reportedPackMessages.has(issue.message)) {
					reportedPackMessages.add(issue.message);
					issues.push(issue);
				}
				continue;
			}
			issues.push({ path: ['scenes', sceneIndex, ...issue.path], message: issue.message });
		}
	}

	// Film length needs a well-formed Scene and boundary list to be counted.
	if (structureIssues.length === 0 && film.scenes.length > 0) {
		const ceilingFrameCount = secondsToFrames(
			FILM_DURATION_CEILING_SECONDS,
			resolveFrameRate(film.fps)
		);
		const totalFrameCount = filmFrameCount(film);
		if (totalFrameCount > ceilingFrameCount) {
			issues.push({
				path: ['scenes'],
				message: `The Film runs ${totalFrameCount} frames, beyond the ${ceilingFrameCount} frames of the ${FILM_DURATION_CEILING_SECONDS}-second ceiling at ${film.fps} fps. Shorten or remove a Scene.`
			});
		}
	}

	return issues;
}

/**
 * Parse a Film document and check its meaning: `FilmIngressSchema`, then
 * `validateFilmSemantics`. Throws one `Error` naming every finding, the way
 * `parsePreset` does for a Preset.
 *
 * Unlike `parsePreset`, nothing is resolved against the Preset catalogue unless
 * the caller passes `resolvePreset`: this module is read by the stores on both
 * sides of the network and must not pull the whole corpus in with it.
 */
export function parseFilm(value: unknown, options: PresetSemanticValidationOptions = {}): Film {
	const result = FilmIngressSchema.safeParse(value);
	if (!result.success) {
		const issues = result.error.issues
			.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
			.join('\n');
		throw new Error(`Invalid GFX film:\n${issues}`);
	}
	const semanticIssues = validateFilmSemantics(result.data, options);
	if (semanticIssues.length > 0) {
		throw new Error(`Invalid GFX film:\n${formatPresetSemanticIssues(semanticIssues)}`);
	}
	return result.data;
}
