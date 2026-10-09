/**
 * What both disk-store write routes do before a byte reaches disk: refuse a
 * Starter's slug, read the request's composition document, and prove its media
 * is servable
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §3).
 */
import { error } from '@sveltejs/kit';

import { getPresetBySlug } from './preset-catalog';
import {
	assertUserCompositionMediaReady,
	inspectUserCompositionMedia
} from './user-composition-media.server';
import {
	isStoredUserCompositionRecordError,
	readStandaloneUserCompositionDocument,
	readUserCompositionDocumentWireBody,
	storedScenePresetViewsOfUserComposition,
	type UserCompositionDocument
} from './user-composition-record';
import { UserCompositionStarterSlugError } from './user-composition-store-errors';

/**
 * Refuse a write under a corpus Preset's slug with 409. `/p/<corpus-slug>`
 * always shows the pristine Starter, so a record there could never be opened.
 */
export function refuseUserCompositionWriteAtStarterSlug(slug: string): void {
	if (getPresetBySlug(slug) !== null) error(409, new UserCompositionStarterSlugError(slug).message);
}

/** How a write request carries its composition document. */
export type UserCompositionWriteRequestBody =
	/** PUT: the body is the standalone document, a Film or a Preset. */
	| 'standalone-document'
	/** POST: the document sits beside `slug`, under `film` or `preset`. */
	| 'keyed-document';

/**
 * The document a write request stores. A Film is stored as it is. A Preset is
 * lifted to a one-Scene Film, except in the one legacy shape
 * `userCompositionWriteShape` still writes. Answers 400 for a document this
 * engine does not accept and 422 for media the origin cannot serve.
 */
export async function readUserCompositionWriteRequest(
	body: unknown,
	bodyShape: UserCompositionWriteRequestBody
): Promise<UserCompositionDocument> {
	let document: UserCompositionDocument;
	try {
		document =
			bodyShape === 'standalone-document'
				? readStandaloneUserCompositionDocument(body, { packScope: 'stored' })
				: readUserCompositionDocumentWireBody(body, { packScope: 'stored' });
	} catch (cause) {
		if (isStoredUserCompositionRecordError(cause)) {
			error(400, `Invalid composition: ${cause.message}`);
		}
		throw cause;
	}
	try {
		for (const scenePreset of storedScenePresetViewsOfUserComposition(document)) {
			assertUserCompositionMediaReady(await inspectUserCompositionMedia(scenePreset));
		}
	} catch (cause) {
		error(422, cause instanceof Error ? cause.message : 'Referenced media asset is unavailable');
	}
	return document;
}
