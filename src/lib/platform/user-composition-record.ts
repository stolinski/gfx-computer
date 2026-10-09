/**
 * The stored record of one User composition, and the one reader both stores
 * share for it
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §3,
 * [ADR-0053](../../../docs/adr/0053-gfx-namespace-and-legacy-supers-compatibility.md)).
 *
 * A record is its metadata beside exactly one composition document. The legacy
 * shape holds a standalone Preset, `{ meta, preset }`. The Film shape holds a
 * Film, `{ meta, film }`. Readers ship before writers: both stores read either
 * shape through `readStoredUserCompositionRecord`, and every writer still emits
 * `{ meta, preset }`, although the Workspace opens what it reads as a Film
 * (`./film-state.svelte.ts`).
 *
 * The disk store keeps this record as `<store>/<slug>.json`. The browser-scoped
 * store keeps the same two metadata fields flat on its own envelope, beside a
 * write token, and hands this reader the record they make.
 */
import {
	filmFromPreset,
	isFilmSceneCountUnsupportedError,
	parseFilm,
	presetFromSingleSceneFilm
} from './film-ingress';
import { PresetIngressSchema } from './preset-ingress';
import {
	formatPresetSemanticIssues,
	validatePresetSemantics,
	type PresetSemanticValidationOptions
} from './preset-validation';
import { isRecord } from '../utils/object';

import type { Preset } from './engine-schema';
import type { Film } from './film-schema';

/** The provenance a stored record keeps outside its composition document. */
export interface StoredUserCompositionMeta {
	forkedFrom: string | null;
	savedAt: string;
}

/**
 * The legacy record, and the one every writer still emits. `preset` holds the
 * Preset's WIRE format (`presetToWireFormat`: annotation bodies as text), not
 * the parsed runtime Preset, because `PresetSchema` is a transform schema and
 * the store must hold its input shape to parse it again. Hence `unknown`.
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
 * both), so that Preset is what the callers still working on one Preset
 * receive, unchanged from before this reader existed.
 */
export type StoredUserCompositionReading =
	| { recordShape: 'preset'; meta: StoredUserCompositionMeta; film: Film; preset: Preset }
	| { recordShape: 'film'; meta: StoredUserCompositionMeta; film: Film };

/**
 * The metadata of a stored record of either shape, or `null` when the value
 * does not carry any. Reads no further than `meta`, so a record whose
 * composition no longer parses still answers what it was forked from. That is
 * what a save over it needs.
 */
export function readStoredUserCompositionMeta(value: unknown): StoredUserCompositionMeta | null {
	if (!isRecord(value)) return null;
	const meta = value['meta'];
	if (!isRecord(meta)) return null;
	const forkedFrom = meta['forkedFrom'];
	const savedAt = meta['savedAt'];
	if ((forkedFrom !== null && typeof forkedFrom !== 'string') || typeof savedAt !== 'string') {
		return null;
	}
	// Any further key an older writer left in `meta` is carried, not dropped.
	return { ...meta, forkedFrom, savedAt };
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
 * Throws `StoredUserCompositionRecordError`. A Film with more than one Scene is
 * a valid record and reads here; `presetForStoredUserComposition` is what
 * refuses to open it.
 */
export function readStoredUserCompositionRecord(
	value: unknown,
	options: PresetSemanticValidationOptions = {}
): StoredUserCompositionReading {
	const meta = readStoredUserCompositionMeta(value);
	if (meta === null || !isRecord(value)) {
		throw new StoredUserCompositionRecordError(
			'not_a_stored_record',
			'A stored User composition record needs `meta` with `forkedFrom` and `savedAt`.'
		);
	}
	const hasPreset = isRecord(value['preset']);
	const hasFilm = isRecord(value['film']);
	if (hasPreset === hasFilm) {
		throw new StoredUserCompositionRecordError(
			'not_a_stored_record',
			'A stored User composition record holds exactly one of `preset` and `film`.'
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
		return { recordShape: 'film', meta, film };
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
		meta.forkedFrom !== null && meta.forkedFrom.length > 0
			? { slug: meta.forkedFrom, contentKey: null }
			: null;
	return {
		recordShape: 'preset',
		meta,
		film: filmFromPreset(result.data, origin),
		preset: result.data
	};
}

/**
 * The one Preset a read record opens as, for everything downstream of the
 * stores that still works on one Preset (the Workspace, operations, export).
 *
 * A legacy record opens as the Preset it stored. A Film record opens as its one
 * Scene (`presetFromSingleSceneFilm`). A Film with more than one Scene cannot
 * be opened yet and is refused with `FilmSceneCountUnsupportedError`; each
 * store reports that the way it reports a stored composition it does not
 * accept.
 */
export function presetForStoredUserComposition(reading: StoredUserCompositionReading): Preset {
	return reading.recordShape === 'preset'
		? reading.preset
		: presetFromSingleSceneFilm(reading.film);
}

/**
 * Whether `cause` is a store read refusing a composition, as opposed to a
 * broken store: the document was found and is a record, and this build will not
 * open it. Both stores answer the two kinds differently.
 */
export function isStoredUserCompositionRefusal(cause: unknown): cause is Error {
	return (
		isFilmSceneCountUnsupportedError(cause) ||
		(isStoredUserCompositionRecordError(cause) && cause.code === 'composition_refused')
	);
}
