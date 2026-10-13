import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vite-plus/test';

/**
 * ADR-0055: User Packs are renderable, never catalog. Every deterministic
 * deliverable gate enumerates `PACK_REGISTRY` and nothing else — a User Pack
 * must never produce verification evidence, and this test is the guard that
 * keeps the runtime pack source, the store, and the user-slug allowance out of
 * those gates.
 */
const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

const DELIVERABLE_GATE_SOURCES = [
	'scripts/verify-presets.ts',
	'scripts/probe-pack-diff.ts',
	'scripts/pack-calibration-verification-inputs.ts',
	'scripts/print-pack-calibration-bundles.ts',
	'scripts/run-gfx-layout-contract-matrix.mjs',
	'scripts/derive-gfx-render-matrix-manifest.ts',
	'src/lib/platform/packs/calibration-bundle.ts',
	'src/lib/platform/preset-verification.ts'
] as const;

const USER_PACK_SURFACES = [
	'user-pack-store',
	'user-pack-runtime',
	'listRuntimeUserPacks',
	'ensurePackLoaded',
	'/api/user-packs',
	"packScope: 'stored'",
	"packScope: 'runtime'",
	'installRuntimePackSource'
] as const;

function sourceText(relativePath: string): string {
	return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('deliverable verification gates stay scoped to PACK_REGISTRY', () => {
	for (const relativePath of DELIVERABLE_GATE_SOURCES) {
		it(`${relativePath} never reaches a User Pack surface`, () => {
			const source = sourceText(relativePath);
			for (const surface of USER_PACK_SURFACES) {
				assert.ok(
					!source.includes(surface),
					`${relativePath} mentions "${surface}"; deliverable gates enumerate PACK_REGISTRY only`
				);
			}
		});
	}

	it('the pack-enumerating gates read the registry itself', () => {
		for (const relativePath of [
			'scripts/verify-presets.ts',
			'scripts/probe-pack-diff.ts',
			'scripts/print-pack-calibration-bundles.ts'
		]) {
			assert.match(sourceText(relativePath), /PACK_REGISTRY/, relativePath);
		}
		assert.match(
			sourceText('scripts/run-gfx-layout-contract-matrix.mjs') +
				sourceText('scripts/derive-gfx-render-matrix-manifest.ts'),
			/PACK_REGISTRY|readPackRegistrySlugsFromSource/
		);
	});

	it('the runtime pack source is installed by the client module alone', () => {
		const installers = ['src/lib/platform/user-pack-runtime.svelte.ts'];
		for (const relativePath of installers) {
			assert.match(sourceText(relativePath), /installRuntimePackSource\(/);
		}
		for (const relativePath of DELIVERABLE_GATE_SOURCES) {
			assert.ok(!sourceText(relativePath).includes('installRuntimePackSource('));
		}
	});
});
