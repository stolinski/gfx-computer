/**
 * User Pack documents on disk, and the save pipeline every write runs
 * (ADR-0055).
 *
 * A stored pack is `<packs>/<slug>.json`: the `PackManifest` beside its store
 * metadata, never inside it. Every write — fork, save — goes through
 * `prepareUserPackSave`, which refuses with named issues, in this order, on any
 * failure: the structural contract a built-in pack passes at boot, the Google
 * Fonts catalog check, the no-shadowing rule against `PACK_REGISTRY`, and font
 * materialization into the same-origin cache. Only a document that passed all
 * four gets a `contentHash` and a place on disk.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalizeDeterministicRenderValue } from './deterministic-render-registry-fingerprint';
import { PACK_REGISTRY } from './packs/registry';
import { PACK_SLUG_PATTERN, type PackManifest } from './packs/types';
import { validateUserPackManifest, type PackValidationIssue } from './packs/validation';
import {
	resolveVariableWeightTreatment,
	variableWeightPrimaryFamily,
	VARIABLE_WEIGHT_TREATMENT_ROLE
} from './packs/variable-weight-treatment';
import { writeUserCompositionFileAtomically } from './user-composition-file-write.server';
import { trashTimestamp } from './user-composition-trash.server';
import {
	materializeUserPackFonts,
	UserPackFontMaterializationError,
	type UserPackFontCacheServices
} from './user-pack-font-cache.server';
import type { UserPackFontFace } from './user-pack-font-faces';
import {
	parseUserPackDocument,
	type UserPackDocument,
	type UserPackForkOptions,
	type UserPackMeta
} from './user-pack-store';
import type { UserPackStoreLocation } from './user-pack-store-location.server';

/** Disk format: metadata beside the manifest so the manifest stays a plain `PackManifest`. */
interface StoredUserPack {
	meta: {
		forkedFrom: string | null;
		savedAt: string;
		contentHash: string;
		fontFaces: readonly UserPackFontFace[];
	};
	manifest: PackManifest;
}

export function userPackFilePath(location: UserPackStoreLocation, slug: string): string {
	if (!PACK_SLUG_PATTERN.test(slug)) {
		throw new TypeError(`User pack slug "${slug}" must use lowercase kebab-case`);
	}
	return join(location.packStoreDirectory, `${slug}.json`);
}

/**
 * sha-256 of the canonical manifest: key order never matters, so two saves of
 * the same look hash alike, and any change to a role or a font changes it.
 */
export function userPackContentHash(manifest: PackManifest): string {
	const canonical = canonicalizeDeterministicRenderValue({
		slug: manifest.slug,
		label: manifest.label,
		description: manifest.description,
		roles: manifest.roles,
		fonts: manifest.fonts ?? []
	});
	return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export type StoredUserPackReadResult =
	| { kind: 'absent' }
	| { kind: 'corrupt'; reason: string }
	| { kind: 'held'; document: UserPackDocument };

/**
 * Absence is a normal answer. Only ENOENT and an empty file mean absent; an
 * unreadable or malformed file is reported as corrupt so a route can answer 500
 * rather than pretend the slug is free.
 */
export async function readStoredUserPack(
	location: UserPackStoreLocation,
	slug: string
): Promise<StoredUserPackReadResult> {
	let raw: string;
	try {
		raw = await readFile(userPackFilePath(location, slug), 'utf-8');
	} catch (cause) {
		if (cause instanceof Error && (cause as NodeJS.ErrnoException).code === 'ENOENT') {
			return { kind: 'absent' };
		}
		throw cause;
	}
	if (raw.trim().length === 0) return { kind: 'absent' };
	let stored: unknown;
	try {
		stored = JSON.parse(raw);
	} catch (cause) {
		return { kind: 'corrupt', reason: cause instanceof Error ? cause.message : String(cause) };
	}
	if (
		typeof stored !== 'object' ||
		stored === null ||
		!('meta' in stored) ||
		!('manifest' in stored) ||
		typeof stored.meta !== 'object' ||
		stored.meta === null
	) {
		return { kind: 'corrupt', reason: 'User pack file must hold { meta, manifest }' };
	}
	try {
		return {
			kind: 'held',
			document: parseUserPackDocument({ manifest: stored.manifest, ...stored.meta })
		};
	} catch (cause) {
		return { kind: 'corrupt', reason: cause instanceof Error ? cause.message : String(cause) };
	}
}

export function userPackMetaFromDocument(slug: string, document: UserPackDocument): UserPackMeta {
	return {
		slug,
		label: document.manifest.label,
		description: document.manifest.description,
		forkedFrom: document.forkedFrom,
		savedAt: document.savedAt,
		contentHash: document.contentHash
	};
}

/** Every readable pack, newest save first. Corrupt or oddly named files are skipped, not fatal. */
export async function listStoredUserPacks(
	location: UserPackStoreLocation
): Promise<UserPackMeta[]> {
	let entries: string[];
	try {
		entries = await readdir(location.packStoreDirectory);
	} catch (cause) {
		if (cause instanceof Error && (cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw cause;
	}
	const metas: UserPackMeta[] = [];
	for (const entry of entries) {
		if (!entry.endsWith('.json')) continue;
		const slug = entry.slice(0, -5);
		if (!PACK_SLUG_PATTERN.test(slug)) continue;
		const result = await readStoredUserPack(location, slug);
		if (result.kind === 'held') metas.push(userPackMetaFromDocument(slug, result.document));
	}
	return metas.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

export async function writeStoredUserPack(
	location: UserPackStoreLocation,
	slug: string,
	document: UserPackDocument
): Promise<void> {
	await mkdir(location.packStoreDirectory, { recursive: true });
	const stored: StoredUserPack = {
		meta: {
			forkedFrom: document.forkedFrom,
			savedAt: document.savedAt,
			contentHash: document.contentHash,
			fontFaces: document.fontFaces
		},
		manifest: document.manifest
	};
	await writeUserCompositionFileAtomically(
		userPackFilePath(location, slug),
		JSON.stringify(stored, null, '\t')
	);
}

/** Move `<packs>/<slug>.json` into trash; false when there was nothing to delete. */
export async function moveUserPackToTrash(
	location: UserPackStoreLocation,
	slug: string,
	now: Date = new Date()
): Promise<boolean> {
	await mkdir(location.trashDirectory, { recursive: true });
	try {
		await rename(
			userPackFilePath(location, slug),
			join(location.trashDirectory, `${trashTimestamp(now)}-${slug}.json`)
		);
	} catch (cause) {
		if (cause instanceof Error && (cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw cause;
	}
	return true;
}

/**
 * A fork takes the built-in's core vocabulary — the bare roles: the seven
 * mandatory cores, User-Pack-materializable optional cores, and the chrome
 * recipe — plus its fonts, under the new slug. The built-in-only variable
 * alias is omitted until User Packs can materialize a real variable range.
 * Its per-Pipeline overrides (`lower-third.accent`,
 * `chapter-card.kicker`, …) stay with the built-in: they beat the cores under
 * ADR-0024's specific → core resolution, so a fork that carried them would
 * render as the built-in whatever its cores were edited to. Null when no
 * built-in has that slug. (Decided with Scott 2026-09-01.)
 */
export function forkedManifestFromBuiltin(
	slug: string,
	builtinSlug: string,
	options: UserPackForkOptions = {}
): PackManifest | null {
	const builtin = PACK_REGISTRY[builtinSlug];
	if (builtin === undefined) return null;
	const variableWeight = resolveVariableWeightTreatment(builtin);
	const variableFamily =
		variableWeight === null ? null : variableWeightPrimaryFamily(variableWeight);
	const roles = Object.fromEntries(
		Object.entries(builtin.roles).filter(
			([key]) => !key.includes('.') && key !== VARIABLE_WEIGHT_TREATMENT_ROLE
		)
	);
	const fonts = builtin.fonts?.filter((font) => font.family !== variableFamily);
	return {
		slug,
		label: options.label ?? builtin.label,
		description: options.description ?? builtin.description,
		roles: structuredClone(roles),
		...(fonts ? { fonts: structuredClone(fonts) } : {})
	};
}

export type UserPackSavePreparation =
	| { kind: 'refused'; issues: readonly PackValidationIssue[] }
	| { kind: 'ready'; document: UserPackDocument };

export interface UserPackSaveContext {
	forkedFrom: string | null;
	fontCacheServices?: UserPackFontCacheServices;
	now?: () => string;
}

/**
 * Validate, then materialize, then stamp — or refuse with every issue named.
 * Nothing here touches the pack store; the caller writes the ready document.
 */
export async function prepareUserPackSave(
	slug: string,
	manifest: PackManifest,
	location: UserPackStoreLocation,
	context: UserPackSaveContext
): Promise<UserPackSavePreparation> {
	const issues: PackValidationIssue[] = [
		...validateUserPackManifest(manifest, { storeSlug: slug })
	];
	if (PACK_REGISTRY[slug] !== undefined) {
		issues.push({
			pack: slug,
			path: ['slug'],
			kind: 'shadows-builtin-pack',
			message: `Pack slug "${slug}" belongs to a built-in pack; a user pack never shadows the catalog — choose another slug`
		});
	}
	if (issues.length > 0) return { kind: 'refused', issues };

	let fontFaces: readonly UserPackFontFace[];
	try {
		fontFaces = await materializeUserPackFonts(
			manifest.fonts ?? [],
			location,
			context.fontCacheServices
		);
	} catch (cause) {
		if (!(cause instanceof UserPackFontMaterializationError)) throw cause;
		const fontIndex = (manifest.fonts ?? []).findIndex(
			(font) => font.family === cause.claim.family
		);
		return {
			kind: 'refused',
			issues: [
				{
					pack: slug,
					path: fontIndex >= 0 ? ['fonts', fontIndex] : ['fonts'],
					kind: 'font-materialization-failed',
					message: cause.message
				}
			]
		};
	}

	return {
		kind: 'ready',
		document: {
			manifest,
			forkedFrom: context.forkedFrom,
			savedAt: (context.now ?? (() => new Date().toISOString()))(),
			contentHash: userPackContentHash(manifest),
			fontFaces
		}
	};
}
