import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Preset } from '../src/lib/platform/engine-schema.ts';
import type { DeterministicRenderSamplePlanEntry } from '../src/lib/platform/deterministic-render-sample-plan.ts';
import { selectAffectedStaticPresetPackAxes } from './preset-validation-scope.ts';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(here, '..');

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith('$lib/')) {
			const base = resolve(defaultRepoRoot, 'src/lib', specifier.slice('$lib/'.length));
			for (const candidate of [`${base}.ts`, resolve(base, 'index.ts'), base]) {
				if (existsSync(candidate))
					return { url: pathToFileURL(candidate).href, shortCircuit: true };
			}
		}
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
				const base = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
				for (const candidate of [`${base}.ts`, resolve(base, 'index.ts')]) {
					if (existsSync(candidate))
						return { url: pathToFileURL(candidate).href, shortCircuit: true };
				}
			}
			throw error;
		}
	},
	load(url, context, nextLoad) {
		if (url.endsWith('/engine-state.svelte.ts')) {
			return {
				format: 'module',
				source:
					"export const engineState = {}; export const packState = { slug: 'syntax' }; export const transitionState = {};",
				shortCircuit: true
			};
		}
		if (url.endsWith('.css') || url.endsWith('.svelte')) {
			return {
				format: 'module',
				source: url.endsWith('.svelte') ? 'export default {};' : '',
				shortCircuit: true
			};
		}
		if (/\.(png|jpe?g|webp|woff2?|wav)$/.test(url)) {
			return {
				format: 'module',
				source: `export default ${JSON.stringify(url)};`,
				shortCircuit: true
			};
		}
		return nextLoad(url, context);
	}
});

(globalThis as typeof globalThis & { $state: <T>(value: T) => T }).$state = <T>(value: T): T =>
	value;

// Dynamic import on purpose: a static one is hoisted above `registerHooks`, and
// surface-mark-instances reaches source modules that import without a `.ts`
// extension, which only the hook above resolves.
const { listSurfaceMarkInstances } = await import('../src/lib/platform/surface-mark-instances.ts');

export const SUPER_RENDER_REQUIRED_CHECK_CODES = [
	'target-resolution-mismatch',
	'font-not-ready',
	'title-safe-violation',
	'vertical-platform-safe-area-violation',
	'readable-content-clipped',
	'readable-content-occluded',
	'readable-content-coverage',
	'contrast-below-floor',
	'cap-height-below-floor',
	'output-class-mismatch',
	'text-edge-softness',
	'shadow-banding',
	'tonal-banding',
	'edge-aliasing',
	'reading-window-too-short',
	'visibility-discontinuity',
	'layout-instability',
	'nondeterministic-replay'
] as const;

export interface GfxCollectedPreset {
	slug: string;
	presetFingerprint: string;
	readingPlanDigest: string;
	readingPlanIds: string[];
	samples: RenderContractSample[];
	frameRate: { num: number; den: number };
	pipelineReferences: string[];
	presetDependencies: string[];
	preset: Preset;
}

export interface RenderContractSample {
	kind: 'checkpoint' | 'transition-window';
	sampleId: string;
	transitionId?: string;
	frameIndex: number;
	timestampMicroseconds: number;
	auxiliaryFrameIndices: readonly number[];
	stableGeometryCandidateIds: readonly string[];
}

export interface GfxRenderRegistrySnapshotInput {
	schemaVersion: 1;
	sourceRevision: string;
	engineFingerprint: string;
	deliverablePresets: Array<{
		slug: string;
		presetFingerprint: string;
		readingPlanDigest: string;
		readingPlanIds: string[];
		samples: RenderContractSample[];
	}>;
	packs: Array<{ id: string; packFingerprint: string }>;
	orientations: ['horizontal', 'vertical'];
	snapshotDigest: string;
}

export interface GfxRenderMatrixManifestInput {
	schemaVersion: 1;
	sourceRevision: string;
	engineFingerprint: string;
	scope: 'affected' | 'full';
	presets: Array<{
		slug: string;
		fingerprint: string;
		readingPlanDigest: string;
		readingPlanIds: string[];
		samples: RenderContractSample[];
	}>;
	packs: Array<{ id: string; fingerprint: string }>;
	orientations: Array<'horizontal' | 'vertical'>;
	requiredCheckCodes: string[];
	coordinates: Array<Record<string, unknown>>;
	manifestDigest: string;
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, entry]) => entry !== undefined)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, canonicalize(entry)])
		);
	}
	return value;
}

export function createGfxRenderMatrixHash(value: unknown): string {
	return createHash('sha256')
		.update(JSON.stringify(canonicalize(value)))
		.digest('hex');
}

function contractSample(sample: DeterministicRenderSamplePlanEntry): RenderContractSample {
	const shared = {
		kind: sample.kind,
		sampleId: sample.sampleId,
		frameIndex: sample.frameIndex,
		timestampMicroseconds: sample.timestampMicroseconds,
		auxiliaryFrameIndices: [...sample.auxiliaryFrameIndices],
		stableGeometryCandidateIds: [...sample.stableGeometryCandidateIds]
	};
	return sample.kind === 'transition-window'
		? { ...shared, kind: sample.kind, transitionId: sample.transitionId }
		: shared;
}

/** Typed references used for conservative concrete-pipeline affected selection. */
export function collectPresetPipelineReferences(preset: Preset): string[] {
	const references = new Set<string>();
	references.add(`surfaces:${preset.state.surface.type}`);
	for (const block of preset.state.surface.diagram ?? []) references.add(`blocks:${block.type}`);
	for (const chart of preset.state.surface.chart?.items ?? [])
		references.add(`blocks:${chart.type}`);
	for (const mark of listSurfaceMarkInstances(preset.state.surface))
		references.add(`annotations:${mark.style}`);
	for (const overlay of preset.state.overlays) references.add(`overlays:${overlay.type}`);
	for (const effect of preset.state.effects) references.add(`effects:${effect.type}`);
	if (preset.state.stage) references.add(`stages:${preset.state.stage.type}`);
	if (preset.state.captions) references.add(`captions:${preset.state.captions.style}`);
	for (const animation of preset.state.textAnimations)
		references.add(`text-animations:${animation.effect}`);
	if (preset.transition) references.add(`transitions:${preset.transition.effect}`);
	return [...references].sort((left, right) => left.localeCompare(right));
}

async function loadRuntimeModules(repoRoot: string): Promise<{
	parse: (value: unknown) => Preset;
	validate: (
		preset: Preset,
		options?: { resolvePreset: (slug: string) => Preset | null }
	) => readonly unknown[];
	packs: Readonly<Record<string, unknown>>;
	validatePacks: (packs: Readonly<Record<string, never>>) => readonly unknown[];
	deriveSamples: (preset: Preset) => {
		samples: readonly DeterministicRenderSamplePlanEntry[];
		frameRate: { num: number; den: number };
	};
	deriveReadingPlan: (
		state: Preset['state']
	) =>
		| { status: 'available'; windows: readonly { readingId: string }[] }
		| { status: 'unavailable'; reason: string };
}> {
	const [ingress, validation, registry, packValidation, samplePlan, readingPlan] =
		await Promise.all([
			import(pathToFileURL(resolve(repoRoot, 'src/lib/platform/preset-ingress.ts')).href),
			import(pathToFileURL(resolve(repoRoot, 'src/lib/platform/preset-validation.ts')).href),
			import(pathToFileURL(resolve(repoRoot, 'src/lib/platform/packs/registry.ts')).href),
			import(pathToFileURL(resolve(repoRoot, 'src/lib/platform/packs/validation.ts')).href),
			import(
				pathToFileURL(resolve(repoRoot, 'src/lib/platform/deterministic-render-sample-plan.ts'))
					.href
			),
			import(
				pathToFileURL(resolve(repoRoot, 'src/lib/platform/deterministic-reading-plan.ts')).href
			)
		]);
	return {
		parse: ingress.parsePresetIngress,
		validate: validation.validatePresetSemantics,
		packs: registry.PACK_REGISTRY,
		validatePacks: packValidation.validatePackRegistry,
		deriveSamples: samplePlan.deriveDeterministicRenderSamplePlan,
		deriveReadingPlan: readingPlan.deriveDeterministicReadingPlan
	};
}

/** Independently collect the same schema/semantic deliverable set exposed by listPresets(). */
export async function collectGfxRenderRegistry(repoRoot = defaultRepoRoot): Promise<{
	presets: GfxCollectedPreset[];
	knownPresetSlugs: string[];
	packs: Array<{ id: string; packFingerprint: string }>;
}> {
	const runtime = await loadRuntimeModules(repoRoot);
	const presetDirectory = resolve(repoRoot, 'src/lib/presets');
	const parsed = new Map<string, Preset>();
	for (const filename of (await readdir(presetDirectory))
		.filter((name) => name.endsWith('.json'))
		.sort()) {
		const slug = filename.slice(0, -'.json'.length);
		parsed.set(
			slug,
			runtime.parse(JSON.parse(await readFile(resolve(presetDirectory, filename), 'utf8')))
		);
	}
	for (const [slug, preset] of parsed) {
		const issues = runtime.validate(preset, {
			resolvePreset: (identity) => parsed.get(identity) ?? null
		});
		if (issues.length > 0)
			throw new TypeError(`Built-in Preset ${slug} failed semantic validation`);
	}
	const packIssues = runtime.validatePacks(runtime.packs as Readonly<Record<string, never>>);
	if (packIssues.length > 0) throw new TypeError('Live Pack registry failed validation');
	const presets: GfxCollectedPreset[] = [];
	for (const [slug, preset] of parsed) {
		if (preset.kind === 'fixture') continue;
		const samplePlan = runtime.deriveSamples(preset);
		const readingPlan = runtime.deriveReadingPlan(preset.state);
		if (readingPlan.status === 'unavailable') {
			throw new TypeError(`Preset ${slug} reading plan unavailable: ${readingPlan.reason}`);
		}
		const readingPlanIds = readingPlan.windows.map((entry) => entry.readingId).sort();
		presets.push({
			slug,
			presetFingerprint: createGfxRenderMatrixHash(preset),
			readingPlanDigest: createGfxRenderMatrixHash(readingPlan.windows),
			readingPlanIds,
			samples: samplePlan.samples.map(contractSample),
			frameRate: samplePlan.frameRate,
			pipelineReferences: collectPresetPipelineReferences(preset),
			presetDependencies: preset.transition
				? [preset.transition.from, preset.transition.to].sort((left, right) =>
						left.localeCompare(right)
					)
				: [],
			preset
		});
	}
	presets.sort((left, right) => left.slug.localeCompare(right.slug));
	const knownPresetSlugs = [...parsed.keys()].sort((left, right) => left.localeCompare(right));
	const packs = Object.entries(runtime.packs)
		.map(([id, pack]) => ({ id, packFingerprint: createGfxRenderMatrixHash(pack) }))
		.sort((left, right) => left.id.localeCompare(right.id));
	return { presets, knownPresetSlugs, packs };
}

export async function deriveGfxRenderMatrixManifest(input: {
	repoRoot?: string;
	sourceRevision: string;
	engineFingerprint: string;
	scope: 'affected' | 'full';
	changedPaths?: readonly string[];
}): Promise<{
	snapshot: GfxRenderRegistrySnapshotInput;
	manifest: GfxRenderMatrixManifestInput | null;
}> {
	const registry = await collectGfxRenderRegistry(input.repoRoot);
	const snapshotContent = {
		schemaVersion: 1 as const,
		sourceRevision: input.sourceRevision,
		engineFingerprint: input.engineFingerprint,
		deliverablePresets: registry.presets.map((preset) => ({
			slug: preset.slug,
			presetFingerprint: preset.presetFingerprint,
			readingPlanDigest: preset.readingPlanDigest,
			readingPlanIds: preset.readingPlanIds,
			samples: preset.samples
		})),
		packs: registry.packs,
		orientations: ['horizontal', 'vertical'] as ['horizontal', 'vertical']
	};
	const snapshot = {
		...snapshotContent,
		snapshotDigest: createGfxRenderMatrixHash(snapshotContent)
	};
	const selectedAxes =
		input.scope === 'full'
			? registry.presets.flatMap((preset) =>
					registry.packs.map((pack) => ({ presetSlug: preset.slug, packId: pack.id }))
				)
			: selectAffectedStaticPresetPackAxes(registry, input.changedPaths ?? []);
	if (selectedAxes.length === 0) return { snapshot, manifest: null };
	const coordinates: Array<Record<string, unknown>> = [];
	for (const axis of selectedAxes) {
		const preset = registry.presets.find((entry) => entry.slug === axis.presetSlug);
		const pack = registry.packs.find((entry) => entry.id === axis.packId);
		if (!preset || !pack) throw new TypeError('Affected selector produced an unknown live axis');
		for (const orientation of snapshot.orientations) {
			for (const sample of preset.samples) {
				const content = {
					schemaVersion: 1,
					sourceRevision: input.sourceRevision,
					engineFingerprint: input.engineFingerprint,
					presetSlug: preset.slug,
					presetFingerprint: preset.presetFingerprint,
					packId: pack.id,
					packFingerprint: pack.packFingerprint,
					orientation,
					frameRate: preset.frameRate,
					width: orientation === 'horizontal' ? 3840 : 2160,
					height: orientation === 'horizontal' ? 2160 : 3840,
					sample
				};
				coordinates.push({ ...content, cellId: createGfxRenderMatrixHash(content) });
			}
		}
	}
	coordinates.sort((left, right) => String(left.cellId).localeCompare(String(right.cellId)));
	const selectedPresetIds = new Set(selectedAxes.map((entry) => entry.presetSlug));
	const selectedPackIds = new Set(selectedAxes.map((entry) => entry.packId));
	const manifestContent = {
		schemaVersion: 1 as const,
		sourceRevision: input.sourceRevision,
		engineFingerprint: input.engineFingerprint,
		scope: input.scope,
		presets: registry.presets
			.filter((entry) => selectedPresetIds.has(entry.slug))
			.map((preset) => ({
				slug: preset.slug,
				fingerprint: preset.presetFingerprint,
				readingPlanDigest: preset.readingPlanDigest,
				readingPlanIds: preset.readingPlanIds,
				samples: preset.samples
			})),
		packs: registry.packs
			.filter((entry) => selectedPackIds.has(entry.id))
			.map((pack) => ({ id: pack.id, fingerprint: pack.packFingerprint })),
		orientations: [...snapshot.orientations],
		requiredCheckCodes: [...SUPER_RENDER_REQUIRED_CHECK_CODES],
		coordinates
	};
	return {
		snapshot,
		manifest: { ...manifestContent, manifestDigest: createGfxRenderMatrixHash(manifestContent) }
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [scope, sourceRevision, engineFingerprint, changedPathsJson = '[]'] = process.argv.slice(2);
	deriveGfxRenderMatrixManifest({
		scope: scope === 'affected' ? 'affected' : 'full',
		sourceRevision,
		engineFingerprint,
		changedPaths: JSON.parse(changedPathsJson) as string[]
	}).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`));
}
