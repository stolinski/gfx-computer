import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { json, error, type RequestHandler } from '@sveltejs/kit';

import { assertOriginCompositionStoreServed } from '$lib/platform/origin-composition-routes.server';
import {
	addUserCompositionFileToIndex,
	removeUserCompositionFileFromIndex
} from '$lib/platform/user-composition-file-index.server';
import { writeUserCompositionFileAtomically } from '$lib/platform/user-composition-file-write.server';
import type { Preset } from '$lib/platform/engine-schema';
import { PresetIngressSchema } from '$lib/platform/preset-ingress';
import { presetToWireFormat } from '$lib/platform/preset-pure';
import {
	formatPresetSemanticIssues,
	validatePresetSemantics
} from '$lib/platform/preset-validation';
import {
	assertUserCompositionMediaReady,
	inspectUserCompositionMedia
} from '$lib/platform/user-composition-media.server';
import {
	isStoredUserCompositionRefusal,
	presetForStoredUserComposition,
	readStoredUserCompositionMeta,
	readStoredUserCompositionRecord,
	type StoredPresetUserCompositionRecord,
	type StoredUserCompositionMeta
} from '$lib/platform/user-composition-record';
import { snapshotUserCompositionStore } from '$lib/platform/user-composition-store-backup.server';
import {
	assertUserCompositionDeleteAuthorized,
	requireUserCompositionStoreLocation
} from '$lib/platform/user-composition-store-location.server';
import { moveUserCompositionToTrash } from '$lib/platform/user-composition-trash.server';

function userCompositionPathForSlug(storeDirectory: string, slug: string): string {
	return join(storeDirectory, `${slug}.json`);
}

const pendingUserCompositionReads = new Map<string, Promise<unknown>>();

async function readUserCompositionWirePreset(
	storeDirectory: string,
	slug: string
): Promise<unknown> {
	// "No fork of this slug" is a normal answer, not an error — return null so
	// clients can tell absence apart from a real failure. Only ENOENT means
	// absent; any other read failure must surface as a 500.
	let raw: string;
	try {
		raw = await readFile(userCompositionPathForSlug(storeDirectory, slug), 'utf-8');
	} catch (cause) {
		if (cause instanceof Error && (cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
		error(500, `Failed to read user composition "${slug}"`);
	}

	// Legacy writes could leave an empty file; do not use JSON.parse as the guard.
	if (raw.trim().length === 0) {
		await removeUserCompositionFileFromIndex(slug);
		return null;
	}

	let storedUserComposition: unknown;
	try {
		storedUserComposition = JSON.parse(raw);
	} catch {
		// A partial file left by an interrupted legacy write must not shadow a
		// built-in Preset. Current writes publish atomically, so treat it as absent.
		await removeUserCompositionFileFromIndex(slug);
		return null;
	}

	// A stored document this engine will not accept is the author's work being out
	// of step with the current rules, not this origin failing: the file read, it
	// is a store document, and it is well-formed JSON. Answering 5xx called every
	// such read a server fault and filed one Sentry issue per open — that is what
	// GFX-COMPUTER-18 and GFX-COMPUTER-19 are, both a stored line chart whose
	// domain stopped being allowed after it was saved. 409 keeps the refusal and
	// names every finding, and stays a log line rather than an issue
	// (`docs/sentry-dev-flow.md`: 4xx = log, 5xx = issue). A file that is NOT a
	// store document is a broken store and remains a 500.
	//
	// The record is read as a Film whichever shape was stored (ADR-0068 §3), then
	// opened as the one Preset everything downstream still works on. A Film of
	// more than one Scene is the same kind of refusal: a store document this
	// build cannot open yet.
	let preset: Preset;
	try {
		preset = presetForStoredUserComposition(
			readStoredUserCompositionRecord(storedUserComposition, { packScope: 'stored' })
		);
	} catch (cause) {
		if (!isStoredUserCompositionRefusal(cause)) error(500, 'Corrupt user composition file');
		error(409, `Stored composition "${slug}" is not one this engine accepts:\n${cause.message}`);
	}
	// The API is an interchange boundary: GET returns the same standalone wire.
	// Stored compositions remain readable when immutable media goes missing so
	// the GUI can surface the decoder error and let the author replace or remove
	// a referenced asset. New writes below still reject unavailable media.
	return presetToWireFormat(preset);
}

async function loadUserCompositionWirePreset(
	storeDirectory: string,
	slug: string
): Promise<unknown> {
	// Coalesce by path, not slug: one process can serve a jailed store and the
	// real one across restarts, and the same slug means a different file in each.
	const readKey = userCompositionPathForSlug(storeDirectory, slug);
	const existingRead = pendingUserCompositionReads.get(readKey);
	if (existingRead) return existingRead;

	const pendingRead = readUserCompositionWirePreset(storeDirectory, slug);
	pendingUserCompositionReads.set(readKey, pendingRead);
	try {
		return await pendingRead;
	} finally {
		if (pendingUserCompositionReads.get(readKey) === pendingRead) {
			pendingUserCompositionReads.delete(readKey);
		}
	}
}

export const GET: RequestHandler = async ({ params }) => {
	assertOriginCompositionStoreServed();
	const { storeDirectory } = requireUserCompositionStoreLocation();
	const { slug } = params;
	if (!slug) error(400, 'Missing slug');
	return json(await loadUserCompositionWirePreset(storeDirectory, slug));
};

export const PUT: RequestHandler = async ({ params, request }) => {
	assertOriginCompositionStoreServed();
	const { storeDirectory } = requireUserCompositionStoreLocation();
	const { slug } = params;
	if (!slug) error(400, 'Missing slug');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	const result = PresetIngressSchema.safeParse(body);
	if (!result.success) error(400, `Invalid preset: ${result.error.message}`);
	const semanticIssues = validatePresetSemantics(result.data, { packScope: 'stored' });
	if (semanticIssues.length > 0) {
		error(400, `Invalid preset:\n${formatPresetSemanticIssues(semanticIssues)}`);
	}
	try {
		assertUserCompositionMediaReady(await inspectUserCompositionMedia(result.data));
	} catch (cause) {
		error(422, cause instanceof Error ? cause.message : 'Referenced media asset is unavailable');
	}

	// Preserve existing meta (forkedFrom) when updating.
	let existingMeta: StoredUserCompositionMeta = {
		forkedFrom: null,
		savedAt: new Date().toISOString()
	};
	try {
		const raw = await readFile(userCompositionPathForSlug(storeDirectory, slug), 'utf-8');
		// Either record shape keeps the same metadata, so a save over a stored
		// Film keeps what it was forked from.
		existingMeta = readStoredUserCompositionMeta(JSON.parse(raw)) ?? existingMeta;
	} catch {
		// new file — use default meta
	}

	const storedUserComposition: StoredPresetUserCompositionRecord = {
		meta: { ...existingMeta, savedAt: new Date().toISOString() },
		// Store the wire format (body as text), not the transformed parse output,
		// so GET can re-parse it through PresetSchema without a type mismatch.
		preset: presetToWireFormat(result.data)
	};

	await writeUserCompositionFileAtomically(
		userCompositionPathForSlug(storeDirectory, slug),
		JSON.stringify(storedUserComposition, null, '\t')
	);
	await addUserCompositionFileToIndex(slug);
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ params }) => {
	assertOriginCompositionStoreServed();
	const location = requireUserCompositionStoreLocation();
	// Refuse before snapshotting or moving anything: automation never deletes an
	// author's work, so a verification run must not reach the filesystem at all.
	assertUserCompositionDeleteAuthorized(location);
	const { slug } = params;
	if (!slug) error(400, 'Missing slug');

	// The snapshot is the recoverable copy of every OTHER composition too — the
	// 2026-08-29 loss was a sweep of deletes, not one mistaken click.
	await snapshotUserCompositionStore(location, 'before-delete');
	if (!(await moveUserCompositionToTrash(location, slug))) {
		error(404, `User composition "${slug}" not found`);
	}
	await removeUserCompositionFileFromIndex(slug);

	return new Response(null, { status: 204 });
};
