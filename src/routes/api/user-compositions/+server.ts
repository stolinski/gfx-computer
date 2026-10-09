import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { json, error, type RequestHandler } from '@sveltejs/kit';

import { assertOriginCompositionStoreServed } from '$lib/platform/origin-composition-routes.server';
import { addUserCompositionFileToIndex } from '$lib/platform/user-composition-file-index.server';
import { writeUserCompositionFileAtomically } from '$lib/platform/user-composition-file-write.server';
import { posterKeyForPreset } from '$lib/platform/posters';
import { inspectUserCompositionMedia } from '$lib/platform/user-composition-media.server';
import { requireUserCompositionStoreLocation } from '$lib/platform/user-composition-store-location.server';
import {
	filmDurationSeconds,
	readStoredUserCompositionRecord,
	storedPresetViewOfUserComposition,
	storedUserCompositionRecordFromDocument,
	userCompositionDocumentFromReading
} from '$lib/platform/user-composition-record';
import {
	readUserCompositionWriteRequest,
	refuseUserCompositionWriteAtStarterSlug
} from '$lib/platform/user-composition-write.server';
import type { UserCompositionMeta } from '$lib/platform/user-composition-store';
import { COMPOSITION_SESSION_SLUG_PATTERN } from '$lib/utils/composition-session-slug';

type UserCompositionCardMetadata = Pick<
	UserCompositionMeta,
	'slug' | 'name' | 'forkedFrom' | 'savedAt' | 'posterKey' | 'durationSeconds' | 'surfaceType'
>;

export const GET: RequestHandler = async (event) => {
	assertOriginCompositionStoreServed();
	const { storeDirectory } = requireUserCompositionStoreLocation();
	await mkdir(storeDirectory, { recursive: true });
	const cardView = event.url?.searchParams.get('view') === 'cards';

	let entries: string[];
	try {
		entries = await readdir(storeDirectory);
	} catch {
		entries = [];
	}

	const userCompositionMetadata: Array<UserCompositionMeta | UserCompositionCardMetadata> = [];

	for (const entry of entries) {
		if (!entry.endsWith('.json')) continue;
		const userCompositionSlug = entry.slice(0, -5);
		// A stem outside the alphabet POST accepts is not addressable as
		// `/p/<slug>`. The empty stem of a bare `.json` file is the sharp edge: the
		// listing resolves every card's route from this slug, and an empty route
		// parameter throws there instead of rendering, taking the whole listing
		// down rather than dropping one unreachable entry.
		if (!COMPOSITION_SESSION_SLUG_PATTERN.test(userCompositionSlug)) continue;
		try {
			const raw = await readFile(join(storeDirectory, entry), 'utf-8');
			const storedUserComposition: unknown = JSON.parse(raw);
			// Either record shape reads as a Film (ADR-0068 §3). A record this
			// build cannot open throws here and is skipped with the unreadable
			// ones below. A Film of several Scenes is listed by its first Scene.
			const reading = readStoredUserCompositionRecord(storedUserComposition, {
				packScope: 'stored'
			});
			const preset = storedPresetViewOfUserComposition(userCompositionDocumentFromReading(reading));
			const [firstScene] = reading.film.scenes;
			const cardMetadata = {
				slug: userCompositionSlug,
				name: reading.film.name,
				// Where the first Scene came from. A legacy record states it in
				// `meta.forkedFrom`, which the reader lifts into the Scene's origin.
				forkedFrom: firstScene.origin?.slug ?? reading.meta.forkedFrom ?? null,
				savedAt: reading.meta.savedAt,
				posterKey: posterKeyForPreset(preset),
				durationSeconds: filmDurationSeconds(reading.film),
				surfaceType: firstScene.state.surface.type
			};
			if (cardView) {
				userCompositionMetadata.push(cardMetadata);
				continue;
			}
			const mediaInspection = await inspectUserCompositionMedia(preset);
			userCompositionMetadata.push({
				...cardMetadata,
				media: preset.state.media,
				mediaStatus: mediaInspection.status,
				...(mediaInspection.issues.length > 0 ? { mediaIssues: mediaInspection.issues } : {})
			});
		} catch {
			// skip unreadable entries
		}
	}

	userCompositionMetadata.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
	return json(userCompositionMetadata);
};

export const POST: RequestHandler = async ({ request }) => {
	assertOriginCompositionStoreServed();
	const { storeDirectory } = requireUserCompositionStoreLocation();
	await mkdir(storeDirectory, { recursive: true });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (typeof body !== 'object' || body === null || !('slug' in body)) {
		error(400, 'Body must have { slug, film }');
	}

	const { slug } = body as { slug: unknown };

	if (typeof slug !== 'string' || !COMPOSITION_SESSION_SLUG_PATTERN.test(slug)) {
		error(400, 'slug must be lowercase alphanumeric/hyphen/underscore');
	}
	refuseUserCompositionWriteAtStarterSlug(slug);

	const document = await readUserCompositionWriteRequest(body, 'keyed-document');

	// A Film states where each Scene came from in the Scene's own `origin`, so a
	// new record's metadata is only when it was saved.
	const storedUserComposition = storedUserCompositionRecordFromDocument(
		{ savedAt: new Date().toISOString() },
		document
	);

	await writeUserCompositionFileAtomically(
		join(storeDirectory, `${slug}.json`),
		JSON.stringify(storedUserComposition, null, '\t')
	);
	await addUserCompositionFileToIndex(slug);
	return json({ slug }, { status: 201 });
};
