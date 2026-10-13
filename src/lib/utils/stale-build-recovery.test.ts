import assert from 'node:assert/strict';

import { afterEach, describe, it, vi } from 'vite-plus/test';

import {
	createStaleBuildRecovery,
	isModuleLoadFailure,
	isOriginFetchFailure,
	type StaleBuildRecoveryDependencies
} from './stale-build-recovery';

describe('isModuleLoadFailure', () => {
	it('recognises every browser message for an unfetchable dynamic import', () => {
		const messages = [
			'Failed to fetch dynamically imported module: https://gfx.robo.online/_app/immutable/chunks/BLOLu1lj2.js',
			'error loading dynamically imported module: https://gfx.robo.online/_app/immutable/chunks/BLOLu1lj2.js',
			'Importing a module script failed.',
			'Unable to preload CSS for /_app/immutable/assets/paper.9WVAg2tx.css'
		];
		for (const message of messages) {
			assert.equal(isModuleLoadFailure(new TypeError(message)), true, message);
		}
	});

	it('leaves every other failure to the caller', () => {
		assert.equal(
			isModuleLoadFailure(new Error('Loaded surface renderer "plain" for definition "paper".')),
			false
		);
		assert.equal(isModuleLoadFailure('Failed to fetch dynamically imported module'), false);
		assert.equal(isModuleLoadFailure(null), false);
	});
});

describe('isOriginFetchFailure', () => {
	it('recognises every browser message for a fetch that never reached the origin', () => {
		// What a `load` throws when the origin restarts while it is fetching
		// `__data.json` — the failure Sentry filed as GFX-COMPUTER-12.
		const messages = [
			'Failed to fetch',
			'NetworkError when attempting to fetch resource.',
			'Load failed'
		];
		for (const message of messages) {
			assert.equal(isOriginFetchFailure(new TypeError(message)), true, message);
		}
	});

	it('leaves a dynamic import failure to isModuleLoadFailure', () => {
		const moduleFailure = new TypeError(
			'Failed to fetch dynamically imported module: https://gfx.robo.online/_app/immutable/chunks/BLOLu1lj2.js'
		);
		assert.equal(isOriginFetchFailure(moduleFailure), false);
		assert.equal(isModuleLoadFailure(moduleFailure), true);
	});

	it('leaves every other failure to the caller', () => {
		assert.equal(isOriginFetchFailure(new Error('Not found')), false);
		assert.equal(isOriginFetchFailure(new Error('Failed to fetch the composition store')), false);
		assert.equal(isOriginFetchFailure('Failed to fetch'), false);
		assert.equal(isOriginFetchFailure(null), false);
	});
});

describe('createStaleBuildRecovery', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function memoryStorage(
		initial: Record<string, string> = {}
	): Pick<Storage, 'getItem' | 'setItem'> & { readonly entries: Map<string, string> } {
		const entries = new Map(Object.entries(initial));
		return {
			entries,
			getItem: (key) => entries.get(key) ?? null,
			setItem: (key, value) => {
				entries.set(key, value);
			}
		};
	}

	function harness(overrides: Partial<StaleBuildRecoveryDependencies> = {}) {
		const storage = memoryStorage();
		const reload = vi.fn();
		const hasNewerBuild = vi.fn(async () => true);
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const recovery = createStaleBuildRecovery({
			buildVersion: 'build-a',
			hasNewerBuild,
			reload,
			storage: () => storage,
			...overrides
		});
		return { recovery, storage, reload, hasNewerBuild };
	}

	it('does nothing while the origin still serves this build', async () => {
		const { recovery, reload, storage } = harness({ hasNewerBuild: async () => false });
		assert.equal(await recovery.reloadIfBuildIsStale(), false);
		assert.equal(reload.mock.calls.length, 0);
		assert.equal(storage.entries.size, 0);
	});

	it('reloads once onto a newer build and remembers which build it left', async () => {
		const { recovery, reload, storage } = harness();
		assert.equal(await recovery.reloadIfBuildIsStale(), true);
		assert.equal(reload.mock.calls.length, 1);
		assert.equal(storage.entries.get('gfx-stale-build-reloaded-from'), 'build-a');
	});

	it('refuses a second reload from the same build so a restart window cannot loop', async () => {
		const storage = memoryStorage({ 'gfx-stale-build-reloaded-from': 'build-a' });
		const { recovery, reload } = harness({ storage: () => storage });
		assert.equal(await recovery.reloadIfBuildIsStale(), false);
		assert.equal(reload.mock.calls.length, 0);
	});

	it('reloads again when the tab is on a later build than the one it last left', async () => {
		const storage = memoryStorage({ 'gfx-stale-build-reloaded-from': 'build-a' });
		const { recovery, reload } = harness({ buildVersion: 'build-b', storage: () => storage });
		assert.equal(await recovery.reloadIfBuildIsStale(), true);
		assert.equal(reload.mock.calls.length, 1);
		assert.equal(storage.entries.get('gfx-stale-build-reloaded-from'), 'build-b');
	});

	it('shares one check and one reload between imports that fail together', async () => {
		const { recovery, reload, hasNewerBuild } = harness();
		const results = await Promise.all([
			recovery.reloadIfBuildIsStale(),
			recovery.reloadIfBuildIsStale(),
			recovery.reloadIfBuildIsStale()
		]);
		assert.deepEqual(results, [true, true, true]);
		assert.equal(hasNewerBuild.mock.calls.length, 1);
		assert.equal(reload.mock.calls.length, 1);
	});

	it('still reloads when the browser refuses storage', async () => {
		const { recovery, reload } = harness({ storage: () => null });
		assert.equal(await recovery.reloadIfBuildIsStale(), true);
		assert.equal(reload.mock.calls.length, 1);
	});

	it('shows the failure instead of reloading when the version check itself fails', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { recovery, reload } = harness({
			hasNewerBuild: async () => {
				throw new TypeError('Failed to fetch');
			}
		});
		assert.equal(await recovery.reloadIfBuildIsStale(), false);
		assert.equal(reload.mock.calls.length, 0);
		assert.equal(consoleError.mock.calls.length, 1);
	});
});
