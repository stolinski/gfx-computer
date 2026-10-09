/**
 * The stored record of one User composition, the one reader both stores share
 * for it, and the one writer
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §3,
 * [ADR-0053](../../../docs/adr/0053-gfx-namespace-and-legacy-supers-compatibility.md)).
 *
 * A User composition is a Film. A record is its metadata beside exactly one
 * composition document. The Film shape, `{ meta, film }`, is what every writer
 * emits. The legacy shape, `{ meta, preset }`, holds a standalone Preset: both
 * stores still read it through `readStoredUserCompositionRecord`, and reading
 * never rewrites it. The first save of a legacy record writes the Film shape,
 * with one exception, `userCompositionWriteShape`.
 *
 * The disk store keeps this record as `<store>/<slug>.json`. The browser-scoped
 * store keeps the same metadata flat on its own envelope, beside a write token,
 * and hands this reader the record they make.
 */
import {
	filmFromPreset,
	filmToWireFormat,
	parseFilm,
	presetFromFilmScene,
	presetFromSingleSceneFilm
} from './film-ingress';
import { filmFrameCount } from './film-playhead';
import { FILM_SCHEMA_ID } from './film-schema';
import { legacyPresetEnvelopeFromPreset, type LegacyPresetEnvelope } from './open-film-document';
import { PresetIngressSchema } from './preset-ingress';
import { presetToWireFormat, serializeCompositionState } from './preset-pure';
import {
	formatPresetSemanticIssues,
	validatePresetSemantics,
	type PresetSemanticValidationOptions
} from './preset-validation';
import { framesToSeconds, resolveFrameRate } from '../utils/composition-timing';
import { isRecord } from '../utils/object';

import type { Preset } from './engine-schema';
import type { Film } from './film-schema';

/** The provenance a stored record keeps outside its composition document. */
export interface StoredUserCompositionMeta {
	/**
	 * The corpus Preset a legacy record was forked from. A Film record states
	 * where each Scene came from in the Scene's own `origin`, so new records do
	 * not write this; it is read from, and carried through a save of, a record
	 * that already has it.
	 */
	forkedFrom?: string | null;
	savedAt: string;
}

/**
 * The legacy record. `preset` holds the Preset's WIRE format
 * (`presetToWireFormat`: annotation bodies as text), not the parsed runtime
 * Preset, because `PresetSchema` is a transform schema and the store must hold
 * its input shape to parse it again. Hence `unknown`.
 */
export interface StoredPresetUserCompositionRecord {
	meta: StoredUserCompositionMeta;
	preset: unknown;
}

/** The Film record: the Film's wire format (`filmToWireFormat`) beside the same metadata. */
export interface StoredFilmUserCompositionRecord {
	meta: StoredUserCompositionMeta;
	film: unknown;
}

export type StoredUserCompositionRecord =
	StoredPresetUserCompositionRecord | StoredFilmUserCompositionRecord;

/**
 * What both stores hand back for one slug and accept on a write: the Film, and
 * the legacy Preset envelope the Workspace still opens it with
 * (`./open-film-document.ts`). A Film record carries no envelope fields, so it
 * opens as a `deliverable` with no transition recipe.
 */
export interface UserCompositionDocument {
	film: Film;
	legacyPresetEnvelope: LegacyPresetEnvelope;
}

/**
 * Why a stored record could not be read.
 *
 * `not_a_stored_record` is a value that is not a record at all: no metadata, or
 * not exactly one composition document. `composition_refused` is a record whose
 * document this engine does not accept, with every finding in the message.
 */
export type StoredUserCompositionRecordFailureCode = 'not_a_stored_record' | 'composition_refused';

export class StoredUserCompositionRecordError extends Error {
	readonly code: StoredUserCompositionRecordFailureCode;

	constructor(
		code: StoredUserCompositionRecordFailureCode,
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'StoredUserCompositionRecordError';
		this.code = code;
	}
}

export function isStoredUserCompositionRecordError(
	value: unknown
): value is StoredUserCompositionRecordError {
	return value instanceof StoredUserCompositionRecordError;
}

/**
 * A stored record after reading: always a Film, whichever shape was stored.
 *
 * A legacy record also keeps the Preset it parsed to. Its lifted Film cannot
 * carry the Preset's `kind` or its `transition` recipe (`filmFromPreset` drops
 * both), so `userCompositionDocumentFromReading` reads them off that Preset.
 */
export type StoredUserCompositionReading =
	| { recordShape: 'preset'; meta: StoredUserCompositionMeta; film: Film; preset: Preset }
	| { recordShape: 'film'; meta: StoredUserCompositionMeta; film: Film };

/**
 * The metadata of a stored record of either shape, or `null` when the value
 * does not carry any. Reads no further than `meta`, so a record whose
 * composition no longer parses still answers when it was saved and what it was
 * forked from. That is what a save over it needs.
 */
export function readStoredUserCompositionMeta(value: unknown): StoredUserCompositionMeta | null {
	if (!isRecord(value)) return null;
	const meta = value['meta'];
	if (!isRecord(meta)) return null;
	const forkedFrom = meta['forkedFrom'];
	const savedAt = meta['savedAt'];
	if (
		(forkedFrom !== undefined && forkedFrom !== null && typeof forkedFrom !== 'string') ||
		typeof savedAt !== 'string'
	) {
		return null;
	}
	// Any further key an older writer left in `meta` is carried, not dropped.
	return { ...meta, ...(forkedFrom !== undefined ? { forkedFrom } : {}), savedAt };
}

/**
 * Read one stored record of either shape into a Film.
 *
 * A `{ meta, film }` record parses as a Film (`parseFilm`). A legacy
 * `{ meta, preset }` record parses as a Preset through the Preset ingress, so a
 * Legacy Supers document still folds (ADR-0053), and is lifted to a one-Scene
 * Film with `filmFromPreset`. The lifted Scene's origin is the slug the record
 * was forked from with a `null` content key, or `null` when it was not forked.
 *
 * `options` are the semantic-validation options each store already used for a
 * Preset (the disk store passes `packScope: 'stored'`); a Film's Scenes are
 * checked under the same ones.
 *
 * Throws `StoredUserCompositionRecordError`. A Film of any number of Scenes
 * reads here.
 */
export function readStoredUserCompositionRecord(
	value: unknown,
	options: PresetSemanticValidationOptions = {}
): StoredUserCompositionReading {
	const meta = readStoredUserCompositionMeta(value);
	if (meta === null || !isRecord(value)) {
		throw new StoredUserCompositionRecordError(
			'not_a_stored_record',
			'A stored User composition record needs `meta` with `savedAt`.'
		);
	}
	return { meta, ...readCompositionDocumentBody(value, meta.forkedFrom ?? null, options) };
}

type CompositionDocumentBodyReading =
	{ recordShape: 'preset'; film: Film; preset: Preset } | { recordShape: 'film'; film: Film };

/**
 * Read the composition document of a record or of a write request: exactly one
 * of `film` and `preset`. `forkedFrom` is the origin slug a lifted legacy
 * Preset's Scene takes.
 */
function readCompositionDocumentBody(
	value: Record<string, unknown>,
	forkedFrom: string | null,
	options: PresetSemanticValidationOptions
): CompositionDocumentBodyReading {
	const hasPreset = isRecord(value['preset']);
	const hasFilm = isRecord(value['film']);
	if (hasPreset === hasFilm) {
		throw new StoredUserCompositionRecordError(
			'not_a_stored_record',
			'A User composition holds exactly one of `preset` and `film`.'
		);
	}

	if (hasFilm) {
		let film: Film;
		try {
			film = parseFilm(value['film'], options);
		} catch (cause) {
			throw new StoredUserCompositionRecordError(
				'composition_refused',
				cause instanceof Error ? cause.message : 'Invalid GFX film',
				{ cause }
			);
		}
		return { recordShape: 'film', film };
	}

	const result = PresetIngressSchema.safeParse(value['preset']);
	if (!result.success) {
		throw new StoredUserCompositionRecordError('composition_refused', result.error.message);
	}
	const semanticIssues = validatePresetSemantics(result.data, options);
	if (semanticIssues.length > 0) {
		throw new StoredUserCompositionRecordError(
			'composition_refused',
			formatPresetSemanticIssues(semanticIssues)
		);
	}
	const origin =
		forkedFrom !== null && forkedFrom.length > 0 ? { slug: forkedFrom, contentKey: null } : null;
	return {
		recordShape: 'preset',
		film: filmFromPreset(result.data, origin),
		preset: result.data
	};
}

/**
 * Read the body of a write request, `{ film }` or `{ preset }`
 * (`userCompositionDocumentWireBody`), into the document it stores.
 *
 * Throws `StoredUserCompositionRecordError`.
 */
export function readUserCompositionDocumentWireBody(
	value: unknown,
	options: PresetSemanticValidationOptions = {}
): UserCompositionDocument {
	if (!isRecord(value)) {
		throw new StoredUserCompositionRecordError(
			'not_a_stored_record',
			'A User composition holds exactly one of `preset` and `film`.'
		);
	}
	return userCompositionDocumentFromReading({
		meta: { savedAt: '' },
		...readCompositionDocumentBody(value, null, options)
	});
}

/**
 * The document a read record opens as.
 *
 * A Film record opens as its Film. A legacy record opens as the Film it lifts
 * to, with the `kind` and `transition` its Preset stated in the envelope. A
 * Film of several Scenes opens whole, with its first Scene selected
 * (`openFilmDocumentFromFilm`).
 */
export function userCompositionDocumentFromReading(
	reading: StoredUserCompositionReading
): UserCompositionDocument {
	return {
		film: reading.film,
		legacyPresetEnvelope:
			reading.recordShape === 'preset'
				? legacyPresetEnvelopeFromPreset(reading.preset)
				: { kind: 'deliverable' }
	};
}

/** The composition document a writer emits for one User composition: one of the two record shapes. */
export type UserCompositionWriteShape =
	{ recordShape: 'film'; film: Film } | { recordShape: 'preset'; preset: Preset };

/**
 * Which record shape a document is written in. Every writer — both stores, the
 * request body the client store sends, and standalone JSON export — asks here,
 * so the choice is made in one place.
 */
export function userCompositionWriteShape(
	document: UserCompositionDocument
): UserCompositionWriteShape {
	// ADR-0068 §3: a Film cannot hold a two-endpoint transition until the live
	// Scene boundaries change reads a transition Preset as a two-Scene Film. A
	// document whose legacy envelope still carries a `transition` is therefore
	// kept in the legacy `{ meta, preset }` shape, with its `kind`, so the recipe
	// is not lost. This branch goes with that change. Such a document is always
	// one Scene long: the recipe only ever arrives on a legacy Preset.
	if (document.legacyPresetEnvelope.transition !== undefined) {
		const scenePreset = presetFromSingleSceneFilm(document.film);
		return {
			recordShape: 'preset',
			preset: serializeCompositionState(
				{
					name: scenePreset.name,
					description: scenePreset.description,
					kind: document.legacyPresetEnvelope.kind,
					transition: document.legacyPresetEnvelope.transition
				},
				scenePreset.state,
				scenePreset.pack
			)
		};
	}
	return { recordShape: 'film', film: document.film };
}

/**
 * The composition document as JSON, keyed by its record shape: `{ film }` or
 * `{ preset }`, each in its wire format. A stored record is this beside `meta`;
 * the client store sends this as a request body.
 */
export function userCompositionDocumentWireBody(
	document: UserCompositionDocument
): { film: unknown } | { preset: unknown } {
	const shape = userCompositionWriteShape(document);
	return shape.recordShape === 'film'
		? { film: filmToWireFormat(shape.film) }
		: { preset: presetToWireFormat(shape.preset) };
}

/** The record a writer stores for `document` beside `meta`. */
export function storedUserCompositionRecordFromDocument(
	meta: StoredUserCompositionMeta,
	document: UserCompositionDocument
): StoredUserCompositionRecord {
	return { meta, ...userCompositionDocumentWireBody(document) };
}

/**
 * The standalone document of a User composition: the Film's wire format, or
 * the legacy Preset's under the one exception `userCompositionWriteShape`
 * makes. This is what JSON export downloads, and what the disk store's slug
 * route returns from GET and accepts in PUT, so an agent reads a document,
 * edits it, and writes the same document back.
 */
export function standaloneUserCompositionDocument(document: UserCompositionDocument): unknown {
	const body = userCompositionDocumentWireBody(document);
	return 'film' in body ? body.film : body.preset;
}

/**
 * Read a standalone document: a `gfx-film@1` Film, or a Preset, which is
 * lifted to a one-Scene Film that came from no Starter. The inverse of
 * `standaloneUserCompositionDocument`.
 *
 * Throws `StoredUserCompositionRecordError`.
 */
export function readStandaloneUserCompositionDocument(
	value: unknown,
	options: PresetSemanticValidationOptions = {}
): UserCompositionDocument {
	return readUserCompositionDocumentWireBody(
		isRecord(value) && value['schema'] === FILM_SCHEMA_ID ? { film: value } : { preset: value },
		options
	);
}

/**
 * Every Scene of a User composition as the Preset it would be alone, exactly
 * as it would be stored, in Scene order: a Film has no `kind`, so each reads as
 * a `deliverable`. The disk store proves the media of every Scene servable
 * through this before it accepts a write.
 */
export function storedScenePresetViewsOfUserComposition(
	document: UserCompositionDocument
): Preset[] {
	const shape = userCompositionWriteShape(document);
	return shape.recordShape === 'preset'
		? [shape.preset]
		: shape.film.scenes.map((scene) => presetFromFilmScene(shape.film, scene.id));
}

/**
 * The first Scene of a User composition as the Preset it would be alone
 * (`storedScenePresetViewsOfUserComposition`). A Film opens on its first Scene,
 * so that is the Scene its card stands for: the poster content key
 * (`posterKeyForPreset`) and the listing's media read this, on both sides of
 * the network, so a poster captured in the Workspace is the one the listing
 * asks for. An unchanged one-Scene Film whose content equals a `deliverable`
 * Preset keeps that Preset's poster key.
 */
export function storedPresetViewOfUserComposition(document: UserCompositionDocument): Preset {
	const shape = userCompositionWriteShape(document);
	if (shape.recordShape === 'preset') return shape.preset;
	const [firstScene] = shape.film.scenes;
	if (firstScene === undefined) {
		throw new RangeError(`The Film "${shape.film.name}" has no Scene.`);
	}
	return presetFromFilmScene(shape.film, firstScene.id);
}

/**
 * How long a Film runs, in seconds, for a listing: its frame count at the
 * Film's exact rate (`filmFrameCount`), never a sum of Scene seconds.
 */
export function filmDurationSeconds(film: Film): number {
	return framesToSeconds(filmFrameCount(film), resolveFrameRate(film.fps));
}

/**
 * Whether `cause` is a store read refusing a composition, as opposed to a
 * broken store: the document was found and is a record, and this build will not
 * open it. Both stores answer the two kinds differently.
 */
export function isStoredUserCompositionRefusal(cause: unknown): cause is Error {
	return isStoredUserCompositionRecordError(cause) && cause.code === 'composition_refused';
}
