import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, it } from 'vite-plus/test';

import {
	snapshotUserCompositionStore,
	USER_COMPOSITION_SNAPSHOT_LIMIT
} from './user-composition-store-backup.server';
import type { UserCompositionStoreLocation } from './user-composition-store-location.server';

let root: string;
let location: UserCompositionStoreLocation;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'gfx-backup-'));
	location = {
		storeDirectory: join(root, 'compositions'),
		trashDirectory: join(root, 'trash'),
		backupsDirectory: join(root, 'backups'),
		isVerificationRun: false
	};
	await mkdir(location.storeDirectory, { recursive: true });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('user composition store snapshots', () => {
	it('copies the whole store, leaving the originals in place', async () => {
		await writeFile(join(location.storeDirectory, 'one.json'), 'first', 'utf-8');
		await writeFile(join(location.storeDirectory, 'two.json'), 'second', 'utf-8');

		const snapshot = await snapshotUserCompositionStore(location, 'boot');

		assert.ok(snapshot);
		assert.deepEqual((await readdir(snapshot)).sort(), ['one.json', 'two.json']);
		assert.equal(await readFile(join(snapshot, 'one.json'), 'utf-8'), 'first');
		assert.deepEqual((await readdir(location.storeDirectory)).sort(), ['one.json', 'two.json']);
	});

	it('names the snapshot for why it was taken', async () => {
		await writeFile(join(location.storeDirectory, 'one.json'), 'first', 'utf-8');
		const snapshot = await snapshotUserCompositionStore(location, 'before-delete');
		assert.match(snapshot ?? '', /-before-delete$/);
	});

	it('skips an empty or absent store', async () => {
		assert.equal(await snapshotUserCompositionStore(location, 'boot'), null);
		await rm(location.storeDirectory, { recursive: true });
		assert.equal(await snapshotUserCompositionStore(location, 'boot'), null);
	});

	it(`keeps the last ${USER_COMPOSITION_SNAPSHOT_LIMIT} snapshots and prunes older ones`, async () => {
		await writeFile(join(location.storeDirectory, 'one.json'), 'first', 'utf-8');
		for (let minute = 0; minute < USER_COMPOSITION_SNAPSHOT_LIMIT + 5; minute += 1) {
			const at = new Date(Date.UTC(2026, 7, 31, 12, minute));
			await snapshotUserCompositionStore(location, 'boot', at);
		}

		const kept = (await readdir(location.backupsDirectory)).sort();
		assert.equal(kept.length, USER_COMPOSITION_SNAPSHOT_LIMIT);
		// Pruning drops the oldest, so the newest snapshot must survive.
		assert.match(kept.at(-1) ?? '', /^2026-08-31T12-24/);
	});
});
