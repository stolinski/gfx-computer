import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, it } from 'vitest';

import lowerThirdPresetJson from '$lib/presets/lower-third.json';
import transitionWipeDemoPresetJson from '$lib/presets/transition-wipe-demo.json';

import { filmFromPreset, filmToWireFormat } from './film-ingress';
import { getPresetBySlug } from './preset-catalog';
import { parsePresetIngress } from './preset-ingress';
import {
	migrateUserCompositionShadowRecords,
	NotAUserCompositionStoreDirectoryError
} from './user-composition-shadow-record-migration.server';

const CORPUS_SLUGS = ['lower-third', 'transition-wipe-demo', 'blank'];
const SAVED_AT = '2026-09-01T10:00:00.000Z';
const NOW = new Date('2026-10-08T09:30:00.000Z');

let root: string;
let storeDirectory: string;
let trashDirectory: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'gfx-shadow-record-migration-'));
	storeDirectory = join(root, 'compositions');
	trashDirectory = join(root, 'trash');
	await mkdir(storeDirectory);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function writeRecord(slug: string, record: unknown): Promise<string> {
	const contents = JSON.stringify(record, null, '\t');
	await writeFile(join(storeDirectory, `${slug}.json`), contents, 'utf-8');
	return contents;
}

async function readRecord(slug: string): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(join(storeDirectory, `${slug}.json`), 'utf-8')) as Record<
		string,
		unknown
	>;
}

async function storeSnapshot(): Promise<Record<string, string>> {
	const snapshot: Record<string, string> = {};
	for (const entry of (await readdir(storeDirectory)).sort()) {
		snapshot[entry] = await readFile(join(storeDirectory, entry), 'utf-8');
	}
	return snapshot;
}

const shadowRecord = {
	meta: { forkedFrom: 'lower-third', savedAt: SAVED_AT },
	preset: { ...lowerThirdPresetJson, name: 'My lower third' }
};
const ordinaryRecord = {
	meta: { forkedFrom: null, savedAt: SAVED_AT },
	preset: { ...lowerThirdPresetJson, name: 'Untitled' }
};

describe('migrateUserCompositionShadowRecords', () => {
	it('plans every move under a dry run and changes nothing', async () => {
		await writeRecord('lower-third', shadowRecord);
		await writeRecord('untitled', ordinaryRecord);
		const before = await storeSnapshot();

		const report = await migrateUserCompositionShadowRecords({
			storeDirectory,
			corpusSlugs: CORPUS_SLUGS,
			resolveCorpusPreset: getPresetBySlug,
			dryRun: true,
			now: NOW
		});

		assert.deepEqual(report, {
			storeDirectory,
			trashDirectory,
			dryRun: true,
			moves: [
				{
					fromSlug: 'lower-third',
					toSlug: 'lower-third-2',
					fromPath: join(storeDirectory, 'lower-third.json'),
					toPath: join(storeDirectory, 'lower-third-2.json')
				}
			],
			skipped: []
		});
		assert.deepEqual(await storeSnapshot(), before);
		await assert.rejects(readdir(trashDirectory), { code: 'ENOENT' });
	});

	it('re-keys a shadow record as a Film and moves the old file to trash', async () => {
		const shadowFile = await writeRecord('lower-third', shadowRecord);
		const ordinaryFile = await writeRecord('untitled', ordinaryRecord);

		const report = await migrateUserCompositionShadowRecords({
			storeDirectory,
			corpusSlugs: CORPUS_SLUGS,
			resolveCorpusPreset: getPresetBySlug,
			dryRun: false,
			now: NOW
		});

		assert.equal(report.dryRun, false);
		assert.deepEqual(
			report.moves.map((move) => [move.fromSlug, move.toSlug]),
			[['lower-third', 'lower-third-2']]
		);
		assert.deepEqual((await readdir(storeDirectory)).sort(), [
			'lower-third-2.json',
			'untitled.json'
		]);
		// The record keeps its metadata, `savedAt` included: a migration is not an edit.
		assert.deepEqual(await readRecord('lower-third-2'), {
			meta: { forkedFrom: 'lower-third', savedAt: SAVED_AT },
			film: JSON.parse(
				JSON.stringify(
					filmToWireFormat(
						filmFromPreset(parsePresetIngress(shadowRecord.preset), {
							slug: 'lower-third',
							contentKey: null
						})
					)
				)
			)
		});
		// Nothing is deleted: the old file is in trash, byte for byte.
		const trashed = await readdir(trashDirectory);
		assert.deepEqual(trashed, ['2026-10-08T09-30-00-000Z-lower-third.json']);
		assert.equal(await readFile(join(trashDirectory, trashed[0]), 'utf-8'), shadowFile);
		assert.equal(await readFile(join(storeDirectory, 'untitled.json'), 'utf-8'), ordinaryFile);
	});

	it('is a no-op the second time it runs', async () => {
		await writeRecord('lower-third', shadowRecord);
		await migrateUserCompositionShadowRecords({
			storeDirectory,
			corpusSlugs: CORPUS_SLUGS,
			resolveCorpusPreset: getPresetBySlug,
			dryRun: false,
			now: NOW
		});
		const afterFirstRun = await storeSnapshot();
		const trashAfterFirstRun = await readdir(trashDirectory);

		const report = await migrateUserCompositionShadowRecords({
			storeDirectory,
			corpusSlugs: CORPUS_SLUGS,
			resolveCorpusPreset: getPresetBySlug,
			dryRun: false,
			now: NOW
		});

		assert.deepEqual(report.moves, []);
		assert.deepEqual(report.skipped, []);
		assert.deepEqual(await storeSnapshot(), afterFirstRun);
		assert.deepEqual(await readdir(trashDirectory), trashAfterFirstRun);
	});

	it('numbers past every stored slug and every corpus slug', async () => {
		await writeRecord('lower-third', shadowRecord);
		await writeRecord('lower-third-2', ordinaryRecord);
		await writeRecord('blank', ordinaryRecord);

		const report = await migrateUserCompositionShadowRecords({
			storeDirectory,
			// `blank-2` is a corpus slug here, so the shadow of `blank` skips it.
			corpusSlugs: [...CORPUS_SLUGS, 'blank-2', 'lower-third-3'],
			dryRun: false,
			now: NOW
		});

		assert.deepEqual(
			report.moves.map((move) => [move.fromSlug, move.toSlug]),
			[
				['blank', 'blank-3'],
				['lower-third', 'lower-third-4']
			]
		);
		assert.deepEqual((await readdir(storeDirectory)).sort(), [
			'blank-3.json',
			'lower-third-2.json',
			'lower-third-4.json'
		]);
		// A record that was not forked takes the corpus slug it shadowed as its origin.
		const film = (await readRecord('blank-3'))['film'] as { scenes: { origin: unknown }[] };
		assert.deepEqual(film.scenes[0].origin, { slug: 'blank', contentKey: null });
	});

	it('re-keys a legacy transition record as the two-Scene Film of its two endpoints', async () => {
		const meta = { forkedFrom: 'transition-wipe-demo', savedAt: SAVED_AT };
		await writeRecord('transition-wipe-demo', { meta, preset: transitionWipeDemoPresetJson });

		const report = await migrateUserCompositionShadowRecords({
			storeDirectory,
			corpusSlugs: CORPUS_SLUGS,
			resolveCorpusPreset: getPresetBySlug,
			dryRun: false,
			now: NOW
		});

		assert.deepEqual(
			report.moves.map((move) => [move.fromSlug, move.toSlug]),
			[['transition-wipe-demo', 'transition-wipe-demo-2']]
		);
		assert.deepEqual(report.skipped, []);
		const record = await readRecord('transition-wipe-demo-2');
		assert.deepEqual(Object.keys(record), ['meta', 'film']);
		assert.deepEqual(record['meta'], meta);
		const film = record['film'] as {
			scenes: { origin: unknown }[];
			boundaries: { kind: string }[];
		};
		// Each Scene names its own endpoint, not the slug the record shadowed.
		assert.deepEqual(
			film.scenes.map((scene) => scene.origin),
			[
				{ slug: transitionWipeDemoPresetJson.transition.from, contentKey: null },
				{ slug: transitionWipeDemoPresetJson.transition.to, contentKey: null }
			]
		);
		assert.deepEqual(
			film.boundaries.map((boundary) => boundary.kind),
			[transitionWipeDemoPresetJson.transition.effect]
		);
	});

	it('keeps the origin a shadow Film record already states', async () => {
		const origin = { slug: 'blank', contentKey: '0123456789abcdef' };
		const film = filmToWireFormat(filmFromPreset(parsePresetIngress(lowerThirdPresetJson), origin));
		await writeRecord('lower-third', { meta: { savedAt: SAVED_AT }, film });

		await migrateUserCompositionShadowRecords({
			storeDirectory,
			corpusSlugs: CORPUS_SLUGS,
			resolveCorpusPreset: getPresetBySlug,
			dryRun: false,
			now: NOW
		});

		const record = await readRecord('lower-third-2');
		assert.deepEqual(record['meta'], { savedAt: SAVED_AT });
		assert.deepEqual(
			(record['film'] as { scenes: { origin: unknown }[] }).scenes[0].origin,
			origin
		);
	});

	it('skips a shadow record this engine cannot read and leaves it in place', async () => {
		const unreadable = await writeRecord('lower-third', {
			meta: { forkedFrom: null, savedAt: SAVED_AT },
			preset: { name: 'Incomplete' }
		});

		const report = await migrateUserCompositionShadowRecords({
			storeDirectory,
			corpusSlugs: CORPUS_SLUGS,
			resolveCorpusPreset: getPresetBySlug,
			dryRun: false,
			now: NOW
		});

		assert.deepEqual(report.moves, []);
		assert.equal(report.skipped.length, 1);
		assert.equal(report.skipped[0].slug, 'lower-third');
		assert.equal(await readFile(join(storeDirectory, 'lower-third.json'), 'utf-8'), unreadable);
	});

	it('refuses a directory that does not look like a User composition store', async () => {
		const request = {
			corpusSlugs: CORPUS_SLUGS,
			resolveCorpusPreset: getPresetBySlug,
			dryRun: false,
			now: NOW
		};

		await assert.rejects(
			migrateUserCompositionShadowRecords({ ...request, storeDirectory: join(root, 'absent') }),
			NotAUserCompositionStoreDirectoryError
		);
		// Empty: nothing says it is a store.
		await assert.rejects(
			migrateUserCompositionShadowRecords({ ...request, storeDirectory }),
			/holds no stored record/
		);
		// A directory of other JSON, such as a repository root.
		await writeRecord('lower-third', shadowRecord);
		await writeFile(join(storeDirectory, 'package.json'), '{"name":"not-a-record"}', 'utf-8');
		await assert.rejects(
			migrateUserCompositionShadowRecords({ ...request, storeDirectory }),
			/"package.json" is JSON without a stored record's `meta`/
		);
		assert.deepEqual((await readdir(storeDirectory)).sort(), ['lower-third.json', 'package.json']);
	});
});
