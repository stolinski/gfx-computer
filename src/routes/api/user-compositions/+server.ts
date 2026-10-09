import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { json, error, type RequestHandler } from '@sveltejs/kit';

import { assertOriginCompositionStoreServed } from '$lib/platform/origin-composition-routes.server';
import { addUserCompositionFileToIndex } from '$lib/platform/user-composition-file-index.server';
import { writeUserCompositionFileAtomically } from '$lib/platform/user-composition-file-write.server';
import { PresetIngressSchema } from '$lib/platform/preset-ingress';
import { posterKeyForPreset } from '$lib/platform/posters';
import { presetToWireFormat } from '$lib/platform/preset-pure';
import {
	formatPresetSemanticIssues,
	validatePresetSemantics
} from '$lib/platform/preset-validation';
import {
	assertUserCompositionMediaReady,
	inspectUserCompositionMedia
} from '$lib/platform/user-composition-media.server';
import { requireUserCompositionStoreLocation } from '$lib/platform/user-composition-store-location.server';
import {
	presetForStoredUserComposition,
	readStoredUserCompositionRecord,
	type StoredPresetUserCompositionRecord
} from '$lib/platform/user-composition-record';
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
			// ones below, which includes a Film of more than one Scene.
			const reading = readStoredUserCompositionRecord(storedUserComposition, {
				packScope: 'stored'
			});
			const preset = presetForStoredUserComposition(reading);
			const [firstScene] = reading.film.scenes;
			const cardMetadata = {
				slug: userCompositionSlug,
				name: reading.film.name,
				forkedFrom: reading.meta.forkedFrom,
				savedAt: reading.meta.savedAt,
				posterKey: posterKeyForPreset(preset),
				durationSeconds: firstScene.state.transport.durationSeconds,
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

	if (typeof body !== 'object' || body === null || !('slug' in body) || !('preset' in body)) {
		error(400, 'Body must have { slug, preset }');
	}

	const { slug, preset, forkedFrom } = body as {
		slug: unknown;
		preset: unknown;
		forkedFrom?: unknown;
	};

	if (typeof slug !== 'string' || !COMPOSITION_SESSION_SLUG_PATTERN.test(slug)) {
		error(400, 'slug must be lowercase alphanumeric/hyphen/underscore');
	}

	const result = PresetIngressSchema.safeParse(preset);
	if (!result.success) {
		error(400, `Invalid preset: ${result.error.message}`);
	}
	const semanticIssues = validatePresetSemantics(result.data, { packScope: 'stored' });
	if (semanticIssues.length > 0) {
		error(400, `Invalid preset:\n${formatPresetSemanticIssues(semanticIssues)}`);
	}
	try {
		assertUserCompositionMediaReady(await inspectUserCompositionMedia(result.data));
	} catch (cause) {
		error(422, cause instanceof Error ? cause.message : 'Referenced media asset is unavailable');
	}

	const storedUserComposition: StoredPresetUserCompositionRecord = {
		meta: {
			forkedFrom: typeof forkedFrom === 'string' ? forkedFrom : null,
			savedAt: new Date().toISOString()
		},
		// Store the wire format (body as text), not the transformed parse output,
		// so GET can re-parse it through PresetSchema without a type mismatch.
		preset: presetToWireFormat(result.data)
	};

	await writeUserCompositionFileAtomically(
		join(storeDirectory, `${slug}.json`),
		JSON.stringify(storedUserComposition, null, '\t')
	);
	await addUserCompositionFileToIndex(slug);
	return json({ slug }, { status: 201 });
};
