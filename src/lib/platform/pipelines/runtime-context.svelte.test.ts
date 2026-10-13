import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vite-plus/test';

import { pipelineRendererRuntime, PipelineRendererRuntime } from './runtime-context.svelte';
import { PipelineRendererController, type PipelineRuntimeLoaderRegistry } from './runtime-loader';

const EMPTY_LOADERS: PipelineRuntimeLoaderRegistry = {
	surfaces: {},
	blocks: {},
	annotations: {},
	overlays: {},
	effects: {},
	transitions: {}
};

/** Every `.svelte` source under `src/`, which is where a renderer consumer lives. */
function listSvelteSources(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return listSvelteSources(path);
		return entry.isFile() && entry.name.endsWith('.svelte') ? [path] : [];
	});
}

describe('PipelineRendererRuntime', () => {
	it('exposes the active bundle as a directly importable singleton', () => {
		assert.ok(pipelineRendererRuntime instanceof PipelineRendererRuntime);
	});

	// Regression pin: routing this singleton through Svelte context made every
	// mount throw `missing_context` whenever it was created outside the
	// providing component's context chain. Consumers must read the module
	// singleton, so there is no context left to be missing.
	it('is reached without Svelte context, so no consumer can throw missing_context', () => {
		const contextAccessorNames = ['getPipelineRendererRuntime', 'setPipelineRendererRuntime'];
		const offenders = listSvelteSources('src').filter((path) => {
			const source = readFileSync(path, 'utf8');
			return contextAccessorNames.some((accessor) => source.includes(accessor));
		});

		assert.deepEqual(offenders, []);
	});

	it('advances its reactive revision for activation-only bundle changes', () => {
		const controller = new PipelineRendererController(EMPTY_LOADERS);
		const runtime = new PipelineRendererRuntime(controller);
		const before = runtime.activationRevision();
		controller.activate({
			surfaces: new Map(),
			blocks: new Map(),
			annotations: new Map(),
			overlays: new Map(),
			effects: new Map(),
			transitions: new Map()
		});

		assert.equal(runtime.activationRevision(), before + 1);
	});
});
