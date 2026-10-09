/**
 * The one-time migration of shadow records out of a disk User composition
 * store ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §3).
 *
 * The retired fork-on-edit model stored an edited Starter under the Starter's
 * own slug, where it shadowed the corpus Preset on `/p/<slug>`. That route now
 * always shows the pristine Starter and the store refuses to write under a
 * corpus slug, so a shadow record left in a store could never be opened again.
 * This re-keys each one to the first free `<slug>-2`, `<slug>-3`, … and moves
 * the old file to trash. Nothing is deleted, and a second run finds nothing to
 * do.
 *
 * No sidecar moves with a record. The slug index
 * (`./user-composition-file-index.server.ts`) is held in memory by a running
 * server and is rebuilt from the directory. Posters are keyed by content, not
 * by slug (`posterKeyForPreset`).
 *
 * Run by `scripts/migrate-user-composition-shadow-records.ts`. It takes no
 * backup; back the store up first.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { writeUserCompositionFileAtomically } from './user-composition-file-write.server';
import {
	readStoredUserCompositionMeta,
	readStoredUserCompositionRecord,
	storedUserCompositionRecordFromDocument,
	userCompositionDocumentFromReading,
	type UserCompositionDocument
} from './user-composition-record';
import { moveUserCompositionToTrash } from './user-composition-trash.server';

import type { UserCompositionStoreLocation } from './user-composition-store-location.server';

/** One shadow record and where it goes. */
export interface UserCompositionShadowRecordMove {
	/** The corpus slug the record was stored under. */
	fromSlug: string;
	/** The free slug it is re-keyed to. */
	toSlug: string;
	/** The record shape written: a Film, or the legacy Preset shape a transition keeps. */
	recordShape: 'film' | 'preset';
	fromPath: string;
	toPath: string;
}

/** A shadow record the migration leaves exactly as it is, and why. */
export interface UserCompositionShadowRecordSkip {
	slug: string;
	path: string;
	reason: string;
}

export interface UserCompositionShadowRecordMigrationReport {
	storeDirectory: string;
	trashDirectory: string;
	/** True when nothing was written: the moves are a plan. */
	dryRun: boolean;
	moves: UserCompositionShadowRecordMove[];
	skipped: UserCompositionShadowRecordSkip[];
}

export interface UserCompositionShadowRecordMigrationRequest {
	storeDirectory: string;
	/** Every corpus Preset slug, deliverables and fixtures alike. */
	corpusSlugs: readonly string[];
	dryRun: boolean;
	/** The moment stamped into trashed file names. */
	now?: Date;
}

/** The directory handed to the migration does not look like a User composition store. */
export class NotAUserCompositionStoreDirectoryError extends Error {
	readonly storeDirectory: string;

	constructor(storeDirectory: string, reason: string) {
		super(`"${storeDirectory}" does not look like a User composition store: ${reason}`);
		this.name = 'NotAUserCompositionStoreDirectoryError';
		this.storeDirectory = storeDirectory;
	}
}

const RECORD_FILE_SUFFIX = '.json';

/**
 * The record slugs a directory holds, after proving it is a store: a directory
 * with at least one stored record, and no JSON object that is not one.
 */
async function readUserCompositionStoreRecordSlugs(storeDirectory: string): Promise<string[]> {
	let entries: string[];
	try {
		if (!(await stat(storeDirectory)).isDirectory()) {
			throw new NotAUserCompositionStoreDirectoryError(storeDirectory, 'it is not a directory.');
		}
		entries = await readdir(storeDirectory);
	} catch (cause) {
		if (cause instanceof NotAUserCompositionStoreDirectoryError) throw cause;
		throw new NotAUserCompositionStoreDirectoryError(storeDirectory, 'it cannot be read.');
	}

	const slugs: string[] = [];
	let storedRecordCount = 0;
	for (const entry of entries) {
		if (!entry.endsWith(RECORD_FILE_SUFFIX)) continue;
		slugs.push(entry.slice(0, -RECORD_FILE_SUFFIX.length));
		let value: unknown;
		try {
			value = JSON.parse(await readFile(join(storeDirectory, entry), 'utf-8'));
		} catch {
			// An interrupted legacy write can leave an empty or partial file in a
			// real store; it says nothing either way.
			continue;
		}
		if (readStoredUserCompositionMeta(value) === null) {
			throw new NotAUserCompositionStoreDirectoryError(
				storeDirectory,
				`"${entry}" is JSON without a stored record's \`meta\`.`
			);
		}
		storedRecordCount += 1;
	}
	if (storedRecordCount === 0) {
		throw new NotAUserCompositionStoreDirectoryError(storeDirectory, 'it holds no stored record.');
	}
	return slugs;
}

/** The first of `<slug>-2`, `<slug>-3`, … that `takenSlugs` does not hold. */
function firstFreeNumberedSlug(slug: string, takenSlugs: ReadonlySet<string>): string {
	let counter = 2;
	while (takenSlugs.has(`${slug}-${counter}`)) counter += 1;
	return `${slug}-${counter}`;
}

/**
 * The document a shadow record is re-keyed as: what it reads to, with its
 * Scene's origin naming the corpus Preset it shadowed when the record did not
 * already say where the Scene came from.
 */
function readShadowRecordDocument(value: unknown, shadowedSlug: string): UserCompositionDocument {
	const reading = readStoredUserCompositionRecord(value, { packScope: 'stored' });
	const document = userCompositionDocumentFromReading(reading);
	const keepsOrigin = reading.recordShape === 'film' && document.film.scenes[0].origin !== null;
	if (keepsOrigin) return document;
	return {
		...document,
		film: {
			...document.film,
			scenes: document.film.scenes.map((scene) => ({
				...scene,
				origin: { slug: shadowedSlug, contentKey: null }
			}))
		}
	};
}

/**
 * Re-key every record stored under a corpus slug, or plan it under `dryRun`.
 *
 * Each record keeps its metadata, `forkedFrom` and `savedAt` included: a
 * migration is not an edit. It is written as `{ meta, film }`, or kept in the
 * legacy `{ meta, preset }` shape when it carries a transition
 * (`userCompositionWriteShape`). The new file is written before the old one
 * moves to trash, so an interrupted run loses nothing and the next run
 * finishes it. A record this engine cannot read is skipped and left in place.
 *
 * Throws `NotAUserCompositionStoreDirectoryError`.
 */
export async function migrateUserCompositionShadowRecords(
	request: UserCompositionShadowRecordMigrationRequest
): Promise<UserCompositionShadowRecordMigrationReport> {
	const { storeDirectory, dryRun } = request;
	// The same siblings `resolveUserCompositionStoreLocation` puts beside a store.
	const location: UserCompositionStoreLocation = {
		storeDirectory,
		trashDirectory: join(storeDirectory, '..', 'trash'),
		backupsDirectory: join(storeDirectory, '..', 'backups'),
		isVerificationRun: false
	};

	const storedSlugs = await readUserCompositionStoreRecordSlugs(storeDirectory);
	const corpusSlugs = new Set(request.corpusSlugs);
	const takenSlugs = new Set([...storedSlugs, ...corpusSlugs]);
	const report: UserCompositionShadowRecordMigrationReport = {
		storeDirectory,
		trashDirectory: location.trashDirectory,
		dryRun,
		moves: [],
		skipped: []
	};

	for (const fromSlug of storedSlugs.filter((slug) => corpusSlugs.has(slug)).sort()) {
		const fromPath = join(storeDirectory, `${fromSlug}${RECORD_FILE_SUFFIX}`);
		let document: UserCompositionDocument;
		let record: ReturnType<typeof storedUserCompositionRecordFromDocument>;
		try {
			const value: unknown = JSON.parse(await readFile(fromPath, 'utf-8'));
			const meta = readStoredUserCompositionMeta(value);
			if (meta === null) throw new Error('The file is not a stored record.');
			document = readShadowRecordDocument(value, fromSlug);
			record = storedUserCompositionRecordFromDocument(meta, document);
		} catch (cause) {
			report.skipped.push({
				slug: fromSlug,
				path: fromPath,
				reason: cause instanceof Error ? cause.message : 'The record could not be read.'
			});
			continue;
		}

		const toSlug = firstFreeNumberedSlug(fromSlug, takenSlugs);
		takenSlugs.add(toSlug);
		const toPath = join(storeDirectory, `${toSlug}${RECORD_FILE_SUFFIX}`);
		report.moves.push({
			fromSlug,
			toSlug,
			recordShape: 'film' in record ? 'film' : 'preset',
			fromPath,
			toPath
		});
		if (dryRun) continue;

		await writeUserCompositionFileAtomically(toPath, JSON.stringify(record, null, '\t'));
		await moveUserCompositionToTrash(location, fromSlug, request.now);
	}

	return report;
}
