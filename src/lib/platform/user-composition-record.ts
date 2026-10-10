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
 * never rewrites it. The first save of a legacy record writes the Film shape.
 * A legacy record whose Preset states a two-endpoint `transition` reads as a
 * two-Scene Film and is saved as one.
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
	validateFilmSemantics
} from './film-ingress';
import { filmFrameCount } from './film-playhead';
import { FILM_SCHEMA_ID } from './film-schema';
import { legacyPresetEnvelopeFromPreset, type LegacyPresetEnvelope } from './open-film-document';
import { PresetIngressSchema } from './preset-ingress';
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
 * (`./open-film-document.ts`). A Film record carries no envelope field, so it
 * opens as a `deliverable`.
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
 * carry the Preset's `kind` (`filmFromPreset` drops it), so
 * `userCompositionDocumentFromReading` reads it off that Preset.
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
 * A legacy Preset that states a two-endpoint `transition` is lifted to a
 * two-Scene Film with one boundary instead (ADR-0068 §3). Its endpoints are
 * read through `options.resolvePreset`, the catalogue lookup the caller
 * supplies, and each Scene's origin is its endpoint's slug with a `null`
 * content key. The lifted Film is then checked as a Film, so a transition
 * longer than its endpoints allow is refused with its finding.
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
	if (result.data.transition === undefined) {
		return {
			recordShape: 'preset',
			film: filmFromPreset(result.data, origin),
			preset: result.data
		};
	}
	return {
		recordShape: 'preset',
		film: filmFromStoredLegacyTransitionPreset(result.data, options),
		preset: result.data
	};
}

/**
 * The two-Scene Film a stored legacy transition Preset reads as, checked as a
 * Film. Throws `StoredUserCompositionRecordError` when the caller cannot look
 * its endpoints up, an endpoint is gone, or the Film does not hold together.
 */
function filmFromStoredLegacyTransitionPreset(
	preset: Preset,
	options: PresetSemanticValidationOptions
): Film {
	const { resolvePreset } = options;
	if (!resolvePreset) {
		throw new StoredUserCompositionRecordError(
			'composition_refused',
			`"${preset.name}" is a legacy transition composition, and its two endpoint Presets cannot be looked up here.`
		);
	}
	let film: Film;
	try {
		film = filmFromPreset(preset, null, {
			resolveLegacyTransitionEndpoint: (slug) => {
				const endpoint = resolvePreset(slug);
				// A stored record never recorded its endpoints' content keys.
				return endpoint === null ? null : { preset: endpoint, contentKey: null };
			}
		});
	} catch (cause) {
		throw new StoredUserCompositionRecordError(
			'composition_refused',
			cause instanceof Error ? cause.message : 'Invalid legacy transition composition',
			{ cause }
		);
	}
	const filmIssues = validateFilmSemantics(film, options);
	if (filmIssues.length > 0) {
		throw new StoredUserCompositionRecordError(
			'composition_refused',
			formatPresetSemanticIssues(filmIssues)
		);
	}
	return film;
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
 * to, with the `kind` its Preset stated in the envelope. A Film of several
 * Scenes opens whole, with its first Scene selected
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

/**
 * The composition document as JSON: `{ film }`, the Film in its wire format.
 * A stored record is this beside `meta`; the client store sends this as a
 * request body. Every writer emits a Film (ADR-0068 §3): both stores, the
 * client transport, and standalone JSON export. `kind` is not saved.
 */
export function userCompositionDocumentWireBody(document: UserCompositionDocument): {
	film: unknown;
} {
	return { film: filmToWireFormat(document.film) };
}

/** The record a writer stores for `document` beside `meta`. */
export function storedUserCompositionRecordFromDocument(
	meta: StoredUserCompositionMeta,
	document: UserCompositionDocument
): StoredFilmUserCompositionRecord {
	return { meta, ...userCompositionDocumentWireBody(document) };
}

/**
 * The standalone document of a User composition: the Film's wire format. This
 * is what JSON export downloads, and what the disk store's slug route returns
 * from GET and accepts in PUT, so an agent reads a document, edits it, and
 * writes the same document back.
 */
export function standaloneUserCompositionDocument(document: UserCompositionDocument): unknown {
	return userCompositionDocumentWireBody(document).film;
}

/**
 * Read a standalone document: a `gfx-film@1` Film, or a Preset, which is
 * lifted to a Film that came from no Starter (one Scene, or two for a legacy
 * transition Preset). The inverse of `standaloneUserCompositionDocument` for a
 * Film.
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
	return document.film.scenes.map((scene) => presetFromFilmScene(document.film, scene.id));
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
	const [firstScene] = document.film.scenes;
	if (firstScene === undefined) {
		throw new RangeError(`The Film "${document.film.name}" has no Scene.`);
	}
	return presetFromFilmScene(document.film, firstScene.id);
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
