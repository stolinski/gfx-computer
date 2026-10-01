import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import {
	mergePresetValidationChangedPaths,
	parsePresetValidationCommand
} from './preset-validation-command.ts';
import {
	changedPathsRequirePackCatalogFreshness,
	selectAffectedPackCalibrationSlugs,
	selectAffectedStaticPresetPackAxes
} from './preset-validation-scope.ts';
import {
	PACK_CALIBRATION_RENDER_SOURCE_ROOTS,
	createPackCalibrationRenderSourceFingerprint
} from './pack-calibration-render-source-fingerprint.ts';
import { createPackCalibrationVerificationInputs } from './pack-calibration-verification-inputs.ts';

async function createFingerprintTestRepository(): Promise<string> {
	const repoRoot = await mkdtemp(resolve(tmpdir(), 'gfx-pack-fingerprint-'));
	for (const path of PACK_CALIBRATION_RENDER_SOURCE_ROOTS) {
		const absolutePath = resolve(repoRoot, path);
		if (path === 'package.json' || path === 'pnpm-lock.yaml') {
			await mkdir(dirname(absolutePath), { recursive: true });
			await writeFile(absolutePath, `${path}\n`);
		} else {
			await mkdir(absolutePath, { recursive: true });
		}
	}
	await writeFile(
		resolve(repoRoot, 'src/lib/pipelines/renderer.ts'),
		'export const renderRevision = 1;\n'
	);
	for (const packSlug of ['syntax', 'clean-light']) {
		await mkdir(resolve(repoRoot, 'src/lib/packs', packSlug), { recursive: true });
		await writeFile(
			resolve(repoRoot, 'src/lib/packs', packSlug, 'manifest.ts'),
			`export const pack = '${packSlug}';\n`
		);
	}
	await mkdir(resolve(repoRoot, 'src/lib/platform/packs'), { recursive: true });
	await writeFile(
		resolve(repoRoot, 'src/lib/platform/packs/catalog.ts'),
		"export const status = 'draft';\n"
	);
	return repoRoot;
}

const registry = {
	presets: [
		{
			slug: 'lower-third',
			pipelineReferences: ['surfaces:plain', 'overlays:lower-third'],
			presetDependencies: []
		},
		{
			slug: 'chapter-card',
			pipelineReferences: ['surfaces:chapter-card'],
			presetDependencies: []
		}
	],
	knownPresetSlugs: ['chapter-card', 'lower-third', 'sound-escape-hatches'],
	packs: [{ id: 'syntax' }, { id: 'clean-light' }]
};

test('focused CLI validates an explicit Preset across every Pack and both orientations', () => {
	const run = spawnSync(
		process.execPath,
		['--experimental-strip-types', 'scripts/verify-presets.ts', '--preset', 'lower-third'],
		{ cwd: process.cwd(), encoding: 'utf8' }
	);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /lower-third × clean-light \(horizontal \+ vertical\)/);
	assert.match(run.stdout, /lower-third × syntax \(horizontal \+ vertical\)/);
	// One axis per registered Pack, counted from the run rather than restated.
	const axes = run.stdout.match(/^✓ lower-third × /gm)?.length ?? 0;
	assert.ok(axes >= 2, 'the focused run validated no Pack axes');
	assert.match(run.stdout, new RegExp(`Validated ${axes} Preset × Pack axes in both orientations`));
	assert.match(run.stdout, /no browser, capture, export, Critic, or render matrix was launched/);
});

test('focused CLI stops with the first exact selection failure', () => {
	const run = spawnSync(
		process.execPath,
		['--experimental-strip-types', 'scripts/verify-presets.ts', '--preset', 'missing-preset'],
		{ cwd: process.cwd(), encoding: 'utf8' }
	);
	assert.equal(run.status, 1);
	assert.match(run.stderr, /^✗ Unknown built-in Preset: missing-preset\n$/);
});

test('command defaults to all and accepts one or several explicit Presets', () => {
	assert.deepEqual(parsePresetValidationCommand([]), {
		mode: 'all',
		presetSlugs: [],
		changedPaths: []
	});
	assert.deepEqual(
		parsePresetValidationCommand(['--preset', 'lower-third.json', '--preset', 'chapter-card']),
		{
			mode: 'explicit',
			presetSlugs: ['lower-third', 'chapter-card'],
			changedPaths: []
		}
	);
});

test('command accepts explicit or JSON change inventories and an optional baseline', () => {
	assert.deepEqual(
		parsePresetValidationCommand([
			'--affected',
			'--changed',
			'src/lib/presets/lower-third.json',
			'--changed-paths-json',
			'["src/lib/packs/syntax/manifest.ts"]',
			'--base',
			'main'
		]),
		{
			mode: 'affected',
			presetSlugs: [],
			changedPaths: ['src/lib/presets/lower-third.json', 'src/lib/packs/syntax/manifest.ts'],
			baseRevision: 'main'
		}
	);
});

test('explicit paths and baseline-discovered paths are unioned in canonical order', () => {
	assert.deepEqual(
		mergePresetValidationChangedPaths(
			['src/lib/presets/lower-third.json'],
			['src/lib/packs/syntax/manifest.ts', 'src/lib/presets/lower-third.json']
		),
		['src/lib/packs/syntax/manifest.ts', 'src/lib/presets/lower-third.json']
	);
});

test('command rejects mixed scopes, duplicate Presets, and malformed change inventories', () => {
	assert.throws(
		() => parsePresetValidationCommand(['--all', '--preset', 'lower-third']),
		/one validation scope/
	);
	assert.throws(
		() => parsePresetValidationCommand(['--preset', 'lower-third', '--preset', 'lower-third']),
		/must be unique/
	);
	assert.throws(
		() => parsePresetValidationCommand(['--affected', '--changed-paths-json', '{}']),
		/array of strings/
	);
});

test('affected scope is narrow for Presets, Pipelines, and Packs and broad for engine changes', () => {
	assert.deepEqual(
		selectAffectedStaticPresetPackAxes(registry, ['src/lib/presets/lower-third.json']),
		[
			{ presetSlug: 'lower-third', packId: 'clean-light' },
			{ presetSlug: 'lower-third', packId: 'syntax' }
		]
	);
	assert.deepEqual(
		selectAffectedStaticPresetPackAxes(registry, [
			'src/lib/pipelines/overlays/lower-third/renderer.ts'
		]),
		[
			{ presetSlug: 'lower-third', packId: 'clean-light' },
			{ presetSlug: 'lower-third', packId: 'syntax' }
		]
	);
	assert.deepEqual(
		selectAffectedStaticPresetPackAxes(registry, ['src/lib/packs/syntax/manifest.ts']),
		[
			{ presetSlug: 'chapter-card', packId: 'syntax' },
			{ presetSlug: 'lower-third', packId: 'syntax' }
		]
	);
	assert.equal(
		selectAffectedStaticPresetPackAxes(registry, ['src/lib/platform/composition-frame-renderer.ts'])
			.length,
		4
	);
});

test('known unlisted Preset changes do not expand to every deliverable', () => {
	assert.deepEqual(
		selectAffectedStaticPresetPackAxes(registry, [
			'.dex/tasks.jsonl',
			'src/lib/presets/sound-escape-hatches.json'
		]),
		[]
	);
});

test('Preset changes include transitive transition dependents', () => {
	const transitionRegistry = {
		presets: [
			{ slug: 'endpoint', pipelineReferences: ['surfaces:plain'], presetDependencies: [] },
			{
				slug: 'wipe',
				pipelineReferences: ['transitions:mask-wipe'],
				presetDependencies: ['endpoint', 'other-endpoint']
			},
			{
				slug: 'nested-wipe',
				pipelineReferences: ['transitions:mask-wipe'],
				presetDependencies: ['wipe', 'other-endpoint']
			}
		],
		knownPresetSlugs: ['endpoint', 'nested-wipe', 'wipe'],
		packs: [{ id: 'syntax' }]
	};
	assert.deepEqual(
		selectAffectedStaticPresetPackAxes(transitionRegistry, ['src/lib/presets/endpoint.json']),
		[
			{ presetSlug: 'endpoint', packId: 'syntax' },
			{ presetSlug: 'nested-wipe', packId: 'syntax' },
			{ presetSlug: 'wipe', packId: 'syntax' }
		]
	);
});

test('concrete transition, caption, text-animation, and stage changes select their consumers', () => {
	const typedRegistry = {
		presets: [
			{
				slug: 'typed',
				pipelineReferences: [
					'transitions:mask-wipe',
					'captions:karaoke',
					'text-animations:fade-through',
					'stages:depth'
				],
				presetDependencies: []
			}
		],
		knownPresetSlugs: ['typed'],
		packs: [{ id: 'syntax' }]
	};
	for (const path of [
		'src/lib/pipelines/effects/mask-wipe/index.ts',
		'src/lib/pipelines/captions/identity.ts',
		'src/lib/text-animations/raw-catalog/effects/fade-through.json',
		'src/lib/platform/pipelines/depth-stage.ts'
	]) {
		assert.deepEqual(selectAffectedStaticPresetPackAxes(typedRegistry, [path]), [
			{ presetSlug: 'typed', packId: 'syntax' }
		]);
	}
});

test('Pack calibration freshness selects only affected Trio Pack axes', () => {
	assert.deepEqual(
		selectAffectedPackCalibrationSlugs(
			[
				{ presetSlug: 'lower-third', packId: 'syntax' },
				{ presetSlug: 'chapter-card', packId: 'clean-light' },
				{ presetSlug: 'type-hero-vantage', packId: 'crt-terminal' }
			],
			['lower-third', 'type-hero-vantage']
		),
		['crt-terminal', 'syntax']
	);
});

test('Pack catalog freshness ignores broad engine impact but follows direct authored calibration changes', () => {
	const calibrationSlugs = ['lower-third', 'type-hero-vantage'];
	assert.equal(
		changedPathsRequirePackCatalogFreshness(
			['src/lib/platform/pipelines/identity.ts'],
			calibrationSlugs
		),
		false
	);
	assert.equal(
		changedPathsRequirePackCatalogFreshness(
			['src/lib/packs/syntax/manifest.ts'],
			calibrationSlugs
		),
		true
	);
	assert.equal(
		changedPathsRequirePackCatalogFreshness(
			['src/lib/presets/lower-third.json'],
			calibrationSlugs
		),
		true
	);
});

test('documentation changes select no static Preset work and unsafe inventories fail closed', () => {
	assert.deepEqual(
		selectAffectedStaticPresetPackAxes(registry, ['docs/project-control-plane.md']),
		[]
	);
	assert.throws(
		() => selectAffectedStaticPresetPackAxes(registry, ['../outside.ts']),
		/safe project-relative/
	);
	assert.throws(
		() =>
			selectAffectedStaticPresetPackAxes(registry, [
				'src/lib/presets/lower-third.json',
				'src/lib/packs/syntax/manifest.ts'
			]),
		/canonical order/
	);
});

test('render source fingerprints isolate Pack dress while retaining shared renderer drift', async () => {
	const repoRoot = await createFingerprintTestRepository();
	try {
		const syntaxBaseline = await createPackCalibrationRenderSourceFingerprint(repoRoot, 'syntax');
		const cleanLightBaseline = await createPackCalibrationRenderSourceFingerprint(
			repoRoot,
			'clean-light'
		);
		await writeFile(
			resolve(repoRoot, 'src/lib/platform/packs/catalog.ts'),
			"export const status = 'ratified';\n"
		);
		assert.equal(
			await createPackCalibrationRenderSourceFingerprint(repoRoot, 'syntax'),
			syntaxBaseline
		);

		await writeFile(
			resolve(repoRoot, 'src/lib/packs/clean-light/manifest.ts'),
			"export const pack = 'clean-light-v2';\n"
		);
		assert.equal(
			await createPackCalibrationRenderSourceFingerprint(repoRoot, 'syntax'),
			syntaxBaseline
		);
		assert.notEqual(
			await createPackCalibrationRenderSourceFingerprint(repoRoot, 'clean-light'),
			cleanLightBaseline
		);

		await writeFile(
			resolve(repoRoot, 'src/lib/pipelines/renderer.ts'),
			'export const renderRevision = 2;\n'
		);
		assert.notEqual(
			await createPackCalibrationRenderSourceFingerprint(repoRoot, 'syntax'),
			syntaxBaseline
		);
	} finally {
		await rm(repoRoot, { recursive: true, force: true });
	}
});

test('shared producer and verifier input loader binds canonical Trio values and source', async () => {
	const repoRoot = await createFingerprintTestRepository();
	try {
		await mkdir(resolve(repoRoot, 'src/lib/presets'), { recursive: true });
		for (const presetSlug of ['docu-timeline-build', 'lower-third', 'type-hero-vantage']) {
			await writeFile(
				resolve(repoRoot, 'src/lib/presets', `${presetSlug}.json`),
				JSON.stringify({ slug: presetSlug })
			);
		}
		const observedPresetIds: string[] = [];
		const inputs = await createPackCalibrationVerificationInputs({
			repoRoot,
			calibrationTrio: [
				{ presetSlug: 'docu-timeline-build' },
				{ presetSlug: 'lower-third' },
				{ presetSlug: 'type-hero-vantage' }
			],
			packRegistry: { syntax: { label: 'Syntax' } },
			parsePreset: (value) => value,
			createRuntimeIdentity: async (presets, packs) => {
				observedPresetIds.push(...presets.map(({ id }) => id));
				return { presets, packs };
			}
		});
		assert.deepEqual(observedPresetIds, [
			'docu-timeline-build',
			'lower-third',
			'type-hero-vantage'
		]);
		assert.match(inputs.renderSourceFingerprints.syntax, /^[a-f0-9]{64}$/);
		assert.deepEqual(inputs.runtimeIdentity, {
			presets: [
				{ id: 'docu-timeline-build', value: { slug: 'docu-timeline-build' } },
				{ id: 'lower-third', value: { slug: 'lower-third' } },
				{ id: 'type-hero-vantage', value: { slug: 'type-hero-vantage' } }
			],
			packs: [{ id: 'syntax', value: { label: 'Syntax' } }]
		});
	} finally {
		await rm(repoRoot, { recursive: true, force: true });
	}
});
