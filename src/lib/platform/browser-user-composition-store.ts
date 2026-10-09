/**
 * The browser-scoped composition store a Public demo session runs on
 * ([ADR-0053](../../../docs/adr/0053-gfx-namespace-and-legacy-supers-compatibility.md),
 * [ADR-0052](../../../docs/adr/0052-public-runtime-and-retention-architecture.md)).
 *
 * Every record lives in the visitor's own browser under one configured storage
 * identity. Nothing here is ever sent to the origin, associated with an account,
 * or written to origin disk: a reload continues the same session because the
 * browser still holds it, and clearing the browser's storage ends it with
 * nothing surviving on our side.
 *
 * Synchronous local storage is the backing store on purpose. A composition is a
 * small JSON document, the whole session is a handful of them, and a store the
 * session can measure exactly is what makes quota accounting real — browsers
 * report neither the ceiling nor the usage of this area, so the session accounts
 * for itself against the ratified limits instead of discovering the browser's
 * own limit as a thrown write in the middle of an autosave.
 *
 * Storage is a trust boundary even though this process wrote it: another tab, an
 * older release, or a person with devtools open can leave a record behind. Reads
 * therefore parse through the same ingress every other document crosses and drop
 * what does not survive it, rather than trusting the shape they find.
 *
 * That same ingress is what makes an older release's record recoverable rather
 * than lost. A record left behind in a Legacy Supers shape (ADR-0053) still
 * opens, and reading it rewrites it in its current form once, so the session
 * stops carrying an upgrade it has already performed. That rewrite keeps the
 * record a Preset record; it is the one write a read makes.
 *
 * A record holds a Film; one an older release left may hold a Preset
 * (ADR-0068 §3). Both read through `readStoredUserCompositionRecord`, the reader
 * the disk store shares, and both open as a Film. Every write stores what
 * `userCompositionWriteShape` chooses, which is a Film but for one exception,
 * so the first save of a legacy record replaces it with a Film.
 *
 * Two tabs are the one concurrency this store has. They share the storage area
 * and neither knows the other exists, so every write is stamped and a save that
 * would land on a stamp this store never opened is refused rather than applied —
 * see `writeToken` below.
 */
import { posterKeyForPreset } from './posters';
import { readCompositionLegacyUpgrades } from './preset-ingress';
import { presetToWireFormat } from './preset-pure';
import {
	filmDurationSeconds,
	readStoredUserCompositionRecord,
	storedPresetViewOfUserComposition,
	userCompositionDocumentFromReading,
	userCompositionDocumentWireBody,
	type UserCompositionDocument
} from './user-composition-record';
import {
	UserCompositionNotHeldError,
	UserCompositionStarterSlugError
} from './user-composition-store-errors';
import { COMPOSITION_SESSION_SLUG_PATTERN } from '../utils/composition-session-slug';

import type { Preset } from './engine-schema';
import type { PublicCompositionSessionStorageLimits } from './public-runtime-contract';
import type {
	CompositionSessionStorage,
	UserCompositionMeta,
	UserCompositionStore
} from './user-composition-store';

/** Why a browser-scoped store refused, in the operation contract's own codes. */
export type CompositionSessionStorageFailureCode =
	'storage_unavailable' | 'quota_exceeded' | 'limit_exceeded' | 'stale_revision';

/**
 * A refusal the session store raises about its own storage, carrying the
 * corrective code an operation reports rather than collapsing every storage
 * problem into "the store did not respond".
 */
export class CompositionSessionStorageError extends Error {
	readonly code: CompositionSessionStorageFailureCode;

	constructor(code: CompositionSessionStorageFailureCode, message: string) {
		super(message);
		this.name = 'CompositionSessionStorageError';
		this.code = code;
	}
}

export function isCompositionSessionStorageError(
	value: unknown
): value is CompositionSessionStorageError {
	return value instanceof CompositionSessionStorageError;
}

/**
 * What every stored envelope carries beside its composition document: the
 * provenance the document itself does not hold. Same split as the development
 * store's disk format, so a composition means the same thing in either one.
 */
interface StoredBrowserUserCompositionProvenance {
	/** The corpus Preset a legacy record was forked from. New records do not write it. */
	forkedFrom?: string | null;
	savedAt: string;
	/**
	 * The write that produced this record, unique to it. A store instance
	 * remembers the token of every record it opened or wrote, so a save can tell
	 * "this is the version I opened" from "another tab has written here since".
	 * Absent in a record a release that stamped nothing left behind.
	 */
	writeToken?: string;
}

/** The legacy envelope, around a Preset's wire format. */
type StoredBrowserUserComposition = StoredBrowserUserCompositionProvenance & { preset: unknown };

/** The envelope around a Film's wire format (ADR-0068 §3). */
type StoredBrowserFilmUserComposition = StoredBrowserUserCompositionProvenance & {
	film: unknown;
};

type StoredBrowserUserCompositionEnvelope =
	StoredBrowserUserComposition | StoredBrowserFilmUserComposition;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStoredBrowserUserCompositionEnvelope(
	value: unknown
): value is StoredBrowserUserCompositionEnvelope {
	if (!isRecord(value)) return false;
	return (
		(value.forkedFrom === undefined ||
			value.forkedFrom === null ||
			typeof value.forkedFrom === 'string') &&
		typeof value.savedAt === 'string' &&
		(value.writeToken === undefined || typeof value.writeToken === 'string') &&
		// Exactly one composition document, so an envelope is never ambiguous.
		isRecord(value.preset) !== isRecord(value.film)
	);
}

/**
 * The writer half of a write token: one value per store instance, which is one
 * per page load, which is one per tab. It only has to tell two open tabs of the
 * same browser apart, so it is cheap rather than cryptographic — and it is
 * generated without `crypto.randomUUID`, which an insecure context does not
 * expose and which a session store must not depend on being able to write at
 * all.
 */
function createCompositionSessionWriterId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface BrowserUserCompositionStoreOptions {
	/**
	 * Resolves the backing area at each call rather than at construction, so a
	 * store built during server-side rendering still works once the browser that
	 * actually holds the session runs it.
	 */
	resolveStorage: () => Storage | null;
	storageIdentity: string;
	limits: PublicCompositionSessionStorageLimits;
	/**
	 * Whether a corpus Preset has this slug. A record is never written under one
	 * (`UserCompositionStarterSlugError`). Injected so this module does not pull
	 * the whole corpus in.
	 */
	isStarterSlug: (slug: string) => boolean;
}

/** One composition parsed out of storage. */
interface BrowserSessionRecord {
	slug: string;
	forkedFrom: string | null;
	savedAt: string;
	writeToken: string | undefined;
	/** What the record opens as, whichever shape stored it. */
	document: UserCompositionDocument;
}

/**
 * Bytes one key and its value occupy. Local storage holds UTF-16, and browsers
 * charge two bytes per code unit against the origin's allowance, so this is the
 * same unit the browser's own ceiling is expressed in.
 */
function storedRecordBytes(key: string, value: string): number {
	return (key.length + value.length) * 2;
}

export function createBrowserUserCompositionStore(
	options: BrowserUserCompositionStoreOptions
): UserCompositionStore {
	const keyPrefix = `${options.storageIdentity}:`;
	const writerId = createCompositionSessionWriterId();
	let writeCount = 0;

	/**
	 * The write each slug carried when this store last opened or wrote it.
	 *
	 * Opening a composition counts and listing the session does not: a catalog
	 * read tells this tab that a newer version exists, it does not give this tab
	 * that version, so treating a listing as having seen it would license exactly
	 * the overwrite the token exists to refuse.
	 */
	const observedWriteTokens = new Map<string, string>();

	function requireStorage(): Storage {
		const storage = options.resolveStorage();
		if (!storage) {
			throw new CompositionSessionStorageError(
				'storage_unavailable',
				'This browser exposes no local storage, so a composition has nowhere to live. Leave private browsing or allow site data, then reload.'
			);
		}
		return storage;
	}

	function storageKeyForSlug(slug: string): string {
		return `${keyPrefix}${slug}`;
	}

	function requireStorableSlug(slug: string): string {
		if (!COMPOSITION_SESSION_SLUG_PATTERN.test(slug)) {
			throw new TypeError(
				`"${slug}" is not a composition slug this session can store; use lowercase letters, digits, hyphens, and underscores.`
			);
		}
		if (options.isStarterSlug(slug)) throw new UserCompositionStarterSlugError(slug);
		return slug;
	}

	/**
	 * The envelope at one key, without parsing the composition inside it. This is
	 * what the concurrency check and a save's provenance read, so a record too
	 * corrupt to open still answers who wrote it and what it was forked from.
	 */
	function readStoredEnvelope(
		storage: Storage,
		key: string
	): StoredBrowserUserCompositionEnvelope | null {
		const raw = storage.getItem(key);
		if (raw === null || raw.trim().length === 0) return null;

		let stored: unknown;
		try {
			stored = JSON.parse(raw);
		} catch {
			return null;
		}
		return isStoredBrowserUserCompositionEnvelope(stored) ? stored : null;
	}

	function readRecordAt(storage: Storage, key: string): BrowserSessionRecord | null {
		if (!key.startsWith(keyPrefix)) return null;
		const slug = key.slice(keyPrefix.length);
		if (!COMPOSITION_SESSION_SLUG_PATTERN.test(slug)) return null;

		const stored = readStoredEnvelope(storage, key);
		if (!stored) return null;

		// Either shape reads as a Film through the reader the disk store shares
		// (ADR-0068 §3). A record that does not survive is dropped, which includes
		// a Film of more than one Scene: this build opens one-Scene Films.
		const meta = { forkedFrom: stored.forkedFrom ?? null, savedAt: stored.savedAt };
		let document: UserCompositionDocument;
		let legacyPreset: Preset | null = null;
		try {
			const reading = readStoredUserCompositionRecord(
				'film' in stored ? { meta, film: stored.film } : { meta, preset: stored.preset }
			);
			document = userCompositionDocumentFromReading(reading);
			if (reading.recordShape === 'preset') legacyPreset = reading.preset;
		} catch {
			return null;
		}

		if (
			'preset' in stored &&
			legacyPreset !== null &&
			readCompositionLegacyUpgrades(stored.preset).length > 0
		) {
			migrateStoredRecord(storage, key, stored, legacyPreset);
		}

		return {
			slug,
			forkedFrom: document.film.scenes[0]?.origin?.slug ?? stored.forkedFrom ?? null,
			savedAt: stored.savedAt,
			writeToken: stored.writeToken,
			document
		};
	}

	/**
	 * Rewrite a record an older release left in a Legacy Supers shape as the
	 * document this release writes, keeping its provenance and its save time so a
	 * migration never looks like an edit.
	 *
	 * Best effort on purpose. The upgraded body can be larger than the one it
	 * replaces, and a browser already at its own ceiling may refuse the write; the
	 * record then stays legacy, still opens through ingress, and is offered the
	 * same migration on the next read. A refused rewrite must never turn reading a
	 * composition into a failure.
	 *
	 * The rewrite carries the record's own write token forward. A migration is not
	 * a new version of the composition, so it must not read to another tab as one.
	 */
	function migrateStoredRecord(
		storage: Storage,
		key: string,
		stored: StoredBrowserUserComposition,
		preset: Preset
	): void {
		try {
			storage.setItem(key, JSON.stringify({ ...stored, preset: presetToWireFormat(preset) }));
		} catch {
			// The legacy record is intact and still readable; leaving it is the safe answer.
		}
	}

	function readAllRecords(storage: Storage): BrowserSessionRecord[] {
		const records: BrowserSessionRecord[] = [];
		for (const key of sessionKeys(storage)) {
			const record = readRecordAt(storage, key);
			if (record) records.push(record);
		}
		return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
	}

	function sessionKeys(storage: Storage): string[] {
		const keys: string[] = [];
		for (let index = 0; index < storage.length; index += 1) {
			const key = storage.key(index);
			if (key !== null && key.startsWith(keyPrefix)) keys.push(key);
		}
		return keys;
	}

	/**
	 * What this session occupies, by weight rather than by content. Accounting
	 * never parses: a record too corrupt to open still holds its bytes, and an
	 * autosave asks this on every keystroke it settles.
	 */
	function occupiedStorageBytes(storage: Storage, exceptKey?: string): number {
		let total = 0;
		for (const key of sessionKeys(storage)) {
			if (key === exceptKey) continue;
			total += storedRecordBytes(key, storage.getItem(key) ?? '');
		}
		return total;
	}

	/**
	 * Refuse a write that would land on a version of this slug the store never
	 * opened — which, in a browser-scoped session, means a second tab wrote it.
	 *
	 * The refusal is the drift refusal, because that is what this is: the caller
	 * edited a document that has since moved, exactly as a stale Composition
	 * revision means (ADR-0054 §3). Refusing leaves both compositions intact —
	 * the stored one and the one still on this tab's screen — where overwriting
	 * would silently destroy work the visitor can still see in the other tab.
	 *
	 * Only a token this store can read blocks a write. A record written before
	 * this release stamped anything, and a record too corrupt to open, carry
	 * none; neither is another tab's live work, so neither stands in the way of
	 * replacing it.
	 */
	function refuseWriteOverAnotherTab(storage: Storage, slug: string, key: string): void {
		const storedToken = readStoredEnvelope(storage, key)?.writeToken;
		if (storedToken === undefined || observedWriteTokens.get(slug) === storedToken) return;
		throw new CompositionSessionStorageError(
			'stale_revision',
			`"${slug}" was saved by another tab of this browser after this one opened it; open it again to continue from that version.`
		);
	}

	/**
	 * Write one record, having first proved no other tab owns the version it
	 * replaces and that the session can hold it. The composition ceiling is per
	 * document and the session ceiling is the whole store minus whatever this slug
	 * already occupies, because a save replaces its own record rather than adding
	 * to it.
	 */
	function writeRecord(
		storage: Storage,
		slug: string,
		record:
			| Omit<StoredBrowserUserComposition, 'writeToken'>
			| Omit<StoredBrowserFilmUserComposition, 'writeToken'>
	): void {
		const key = storageKeyForSlug(slug);
		refuseWriteOverAnotherTab(storage, slug, key);

		writeCount += 1;
		const writeToken = `${writerId}.${writeCount}`;
		const serialized = JSON.stringify({ ...record, writeToken });
		const bytes = storedRecordBytes(key, serialized);

		if (bytes > options.limits.maxCompositionBytes) {
			throw new CompositionSessionStorageError(
				'limit_exceeded',
				`"${slug}" is ${bytes} bytes and one composition may occupy ${options.limits.maxCompositionBytes}; remove content or media references before saving it.`
			);
		}

		const occupiedBytes = occupiedStorageBytes(storage, key);
		if (occupiedBytes + bytes > options.limits.maxStorageBytes) {
			throw new CompositionSessionStorageError(
				'quota_exceeded',
				`This browser session holds ${occupiedBytes} of ${options.limits.maxStorageBytes} bytes and "${slug}" needs ${bytes} more; delete a composition it no longer needs first.`
			);
		}

		try {
			storage.setItem(key, serialized);
		} catch (cause) {
			// The browser's own ceiling can still be lower than the ratified one. A
			// refused write leaves the record that was already there untouched, so
			// this reports the refusal rather than repairing anything.
			throw new CompositionSessionStorageError(
				'quota_exceeded',
				`This browser refused to store "${slug}": ${cause instanceof Error ? cause.message : 'its own storage limit was reached'}.`
			);
		}
		observedWriteTokens.set(slug, writeToken);
	}

	function metaForRecord(record: BrowserSessionRecord): UserCompositionMeta {
		const { film } = record.document;
		const [firstScene] = film.scenes;
		const preset = storedPresetViewOfUserComposition(record.document);
		return {
			slug: record.slug,
			name: film.name,
			forkedFrom: record.forkedFrom,
			savedAt: record.savedAt,
			posterKey: posterKeyForPreset(preset),
			durationSeconds: filmDurationSeconds(film),
			surfaceType: firstScene.state.surface.type,
			media: preset.state.media,
			// `missing` and `undecodable` describe an asset the origin was asked for
			// and could not serve. A browser-scoped session asks the origin for
			// nothing, so there is no such answer to report here; a media asset this
			// session cannot decode surfaces where it is decoded, at render time.
			mediaStatus: 'ready'
		};
	}

	return {
		async listUserCompositions(): Promise<UserCompositionMeta[]> {
			return readAllRecords(requireStorage()).map(metaForRecord);
		},

		async loadUserComposition(slug: string): Promise<UserCompositionDocument | null> {
			const storage = requireStorage();
			const record = readRecordAt(storage, storageKeyForSlug(slug));
			if (!record) return null;
			// Opening the composition is what earns this tab the right to save over
			// it: from here on, it holds the version the record carries.
			if (record.writeToken !== undefined) observedWriteTokens.set(slug, record.writeToken);
			return record.document;
		},

		async createUserComposition(slug: string, document: UserCompositionDocument): Promise<void> {
			const storage = requireStorage();
			// A Film states where each Scene came from in the Scene's own `origin`,
			// so a new record's provenance is only when it was saved.
			writeRecord(storage, requireStorableSlug(slug), {
				savedAt: new Date().toISOString(),
				...userCompositionDocumentWireBody(document)
			});
		},

		async saveUserComposition(slug: string, document: UserCompositionDocument): Promise<void> {
			const storage = requireStorage();
			const existing = readStoredEnvelope(storage, storageKeyForSlug(slug));
			// The first save of a legacy Preset record lands here and stores a Film
			// in its place (ADR-0068 §3), keeping the `forkedFrom` it recorded.
			writeRecord(storage, requireStorableSlug(slug), {
				...(existing?.forkedFrom !== undefined ? { forkedFrom: existing.forkedFrom } : {}),
				savedAt: new Date().toISOString(),
				...userCompositionDocumentWireBody(document)
			});
		},

		async deleteUserComposition(slug: string): Promise<void> {
			const storage = requireStorage();
			const key = storageKeyForSlug(slug);
			if (storage.getItem(key) === null) {
				throw new UserCompositionNotHeldError(
					slug,
					`Failed to delete User composition "${slug}": this session holds none.`
				);
			}
			storage.removeItem(key);
			// Nothing is left to have been written by anyone, so the next write at
			// this slug starts a new record rather than replacing a version.
			observedWriteTokens.delete(slug);
		},

		async inspectStorage(): Promise<CompositionSessionStorage> {
			const storage = options.resolveStorage();
			if (!storage) return { available: false, usedBytes: null, quotaBytes: null };
			return {
				available: true,
				usedBytes: occupiedStorageBytes(storage),
				quotaBytes: options.limits.maxStorageBytes
			};
		}
	};
}
