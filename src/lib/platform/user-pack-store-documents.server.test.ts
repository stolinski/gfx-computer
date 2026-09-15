import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, it } from 'vitest';

import { PACK_REGISTRY } from './packs/registry.ts';
import { MANDATORY_CORE_ROLES, type PackManifest } from './packs/types.ts';
import type { UserPackFontCacheServices } from './user-pack-font-cache.server.ts';
import {
	forkedManifestFromBuiltin,
	listStoredUserPacks,
	moveUserPackToTrash,
	prepareUserPackSave,
	readStoredUserPack,
	userPackContentHash,
	writeStoredUserPack
} from './user-pack-store-documents.server.ts';
import type { UserPackStoreLocation } from './user-pack-store-location.server.ts';

/** One latin slice per requested tuple, the way Google answers, with deterministic bytes. */
function fakeFontServices(): UserPackFontCacheServices {
	return {
		async fetchStylesheet(url) {
			const family = (new URL(url).searchParams.get('family') ?? '').split(':')[0];
			return url
				.split('ital,wght@')[1]
				.split('&')[0]
				.split(';')
				.map((tuple) => {
					const [italic, weight] = tuple.split(',');
					return `@font-face { font-family: '${family}'; font-style: ${italic === '1' ? 'italic' : 'normal'}; font-weight: ${weight}; src: url(https://fonts.gstatic.com/s/x/${family.replace(/ /g, '')}-${italic}-${weight}.woff2) format('woff2'); unicode-range: U+0000-00FF; }`;
				})
				.join('\n');
		},
		async fetchFontBytes(url) {
			return new TextEncoder().encode(url);
		},
		now: () => '2026-09-01T12:00:00.000Z'
	};
}

let root: string;
let location: UserPackStoreLocation;
let services: UserPackFontCacheServices;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'gfx-user-pack-docs-'));
	location = {
		packStoreDirectory: join(root, 'packs'),
		fontCacheDirectory: join(root, 'fonts'),
		trashDirectory: join(root, 'trash', 'packs'),
		isVerificationRun: false
	};
	services = fakeFontServices();
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function fork(slug = 'my-brand'): PackManifest {
	const manifest = forkedManifestFromBuiltin(slug, 'clean-light', { label: 'My brand' });
	assert.ok(manifest, 'clean-light is a built-in');
	return manifest;
}

async function ready(slug: string, manifest: PackManifest, now = '2026-09-01T12:00:00.000Z') {
	const preparation = await prepareUserPackSave(slug, manifest, location, {
		forkedFrom: 'clean-light',
		fontCacheServices: services,
		now: () => now
	});
	assert.equal(preparation.kind, 'ready', JSON.stringify(preparation));
	if (preparation.kind !== 'ready') throw new Error('unreachable');
	return preparation.document;
}

describe('user pack documents', () => {
	it('forks materializable cores and fonts, leaving overrides and built-in-only aliases behind', () => {
		const manifest = fork();
		assert.equal(manifest.slug, 'my-brand');
		assert.equal(manifest.label, 'My brand');
		for (const core of MANDATORY_CORE_ROLES) assert.ok(manifest.roles[core], core);
		assert.ok(manifest.roles['font-treatment']);
		assert.ok(
			Object.keys(manifest.roles).every((key) => !key.includes('.')),
			'no per-Pipeline override survives a fork'
		);
		assert.ok(Object.keys(PACK_REGISTRY['clean-light'].roles).some((key) => key.includes('.')));
		assert.ok((manifest.fonts ?? []).some((font) => font.family === 'Geist'));
		assert.equal(manifest.roles['variable-weight-treatment'], undefined);
		assert.ok((manifest.fonts ?? []).every((font) => font.family !== 'Geist Variable'));
	});

	it('round-trips fork → save → load byte-stable, with faces for every declared cut', async () => {
		const document = await ready('my-brand', fork());
		assert.match(document.contentHash, /^[a-f0-9]{64}$/);
		assert.ok(document.fontFaces.length > 0);
		assert.ok(document.fontFaces.every((face) => face.url.startsWith('/api/user-pack-fonts/')));

		await writeStoredUserPack(location, 'my-brand', document);
		const firstBytes = await readFile(join(location.packStoreDirectory, 'my-brand.json'));
		const loaded = await readStoredUserPack(location, 'my-brand');
		assert.equal(loaded.kind, 'held');
		if (loaded.kind !== 'held') return;
		assert.deepEqual(loaded.document, document);

		await writeStoredUserPack(location, 'my-brand', loaded.document);
		assert.deepEqual(
			await readFile(join(location.packStoreDirectory, 'my-brand.json')),
			firstBytes
		);
	});

	it('refuses a slug that would shadow a built-in pack', async () => {
		const manifest = { ...fork('syntax') };
		const preparation = await prepareUserPackSave('syntax', manifest, location, {
			forkedFrom: 'clean-light',
			fontCacheServices: services
		});
		assert.equal(preparation.kind, 'refused');
		if (preparation.kind !== 'refused') return;
		assert.deepEqual(
			preparation.issues.map((issue) => issue.kind),
			['shadows-builtin-pack']
		);
	});

	it('refuses a document missing a mandatory core, naming the role', async () => {
		const manifest = fork();
		const roles = { ...manifest.roles };
		delete roles['fill-treatment'];
		const preparation = await prepareUserPackSave('my-brand', { ...manifest, roles }, location, {
			forkedFrom: null,
			fontCacheServices: services
		});
		assert.equal(preparation.kind, 'refused');
		if (preparation.kind !== 'refused') return;
		assert.ok(preparation.issues.some((issue) => issue.kind === 'invalid-core-role'));
		assert.ok(preparation.issues.some((issue) => issue.path.includes('fill-treatment')));
	});

	it('refuses a manifest whose slug is not the slug it is stored under', async () => {
		const preparation = await prepareUserPackSave('my-brand', fork('other-brand'), location, {
			forkedFrom: null,
			fontCacheServices: services
		});
		assert.equal(preparation.kind, 'refused');
		if (preparation.kind === 'refused') {
			assert.ok(preparation.issues.some((issue) => issue.kind === 'registry-slug-mismatch'));
		}
	});

	it('refuses, with the font named, when a claimed cut cannot be fetched', async () => {
		services.fetchFontBytes = async () => {
			throw new Error('503 Service Unavailable');
		};
		const preparation = await prepareUserPackSave('my-brand', fork(), location, {
			forkedFrom: null,
			fontCacheServices: services
		});
		assert.equal(preparation.kind, 'refused');
		if (preparation.kind !== 'refused') return;
		assert.equal(preparation.issues.length, 1);
		assert.equal(preparation.issues[0].kind, 'font-materialization-failed');
		assert.deepEqual(preparation.issues[0].path, ['fonts', 0]);
		assert.match(preparation.issues[0].message, /Geist/);
	});

	it('hashes the canonical manifest, so key order is irrelevant and any edit is visible', () => {
		const manifest = fork();
		const reordered: PackManifest = {
			fonts: manifest.fonts,
			roles: Object.fromEntries(Object.entries(manifest.roles).reverse()),
			description: manifest.description,
			label: manifest.label,
			slug: manifest.slug
		};
		assert.equal(userPackContentHash(reordered), userPackContentHash(manifest));
		assert.notEqual(
			userPackContentHash({ ...manifest, label: 'Renamed' }),
			userPackContentHash(manifest)
		);
	});

	it('lists readable packs newest first and skips corrupt files', async () => {
		await writeStoredUserPack(
			location,
			'older',
			await ready('older', fork('older'), '2026-09-01T01:00:00.000Z')
		);
		await writeStoredUserPack(
			location,
			'newer',
			await ready('newer', fork('newer'), '2026-09-01T02:00:00.000Z')
		);
		await writeFile(join(location.packStoreDirectory, 'broken.json'), '{ not json');
		await writeFile(join(location.packStoreDirectory, 'Bad Slug.json'), '{}');
		const metas = await listStoredUserPacks(location);
		assert.deepEqual(
			metas.map((meta) => meta.slug),
			['newer', 'older']
		);
		assert.equal(metas[0].forkedFrom, 'clean-light');
		assert.equal((await readStoredUserPack(location, 'broken')).kind, 'corrupt');
		assert.equal((await readStoredUserPack(location, 'missing')).kind, 'absent');
	});

	it('deletes into trash rather than destroying', async () => {
		await writeStoredUserPack(location, 'my-brand', await ready('my-brand', fork()));
		assert.equal(await moveUserPackToTrash(location, 'my-brand'), true);
		assert.equal((await readStoredUserPack(location, 'my-brand')).kind, 'absent');
		const trashed = await readdir(location.trashDirectory);
		assert.equal(trashed.length, 1);
		assert.match(trashed[0], /-my-brand\.json$/);
		assert.equal(await moveUserPackToTrash(location, 'my-brand'), false);
	});

	it('lists nothing from a store directory that does not exist yet', async () => {
		await mkdir(root, { recursive: true });
		assert.deepEqual(await listStoredUserPacks(location), []);
	});
});
