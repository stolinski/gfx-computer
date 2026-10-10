/**
 * probe-pack-diff.ts — ADR-0038's regression lock, catalog-wide and
 * attributable: rendering any Preset under two Packs must produce a visible
 * pixel diff INSIDE every non-immune Pipeline's own region, for every pair of
 * catalog Packs — and a Pack-immune Pipeline's region must stay stable.
 *
 * For every Pipeline registered in IDENTITY_REGISTRY this script:
 *   1. picks a representative built-in Preset that exercises it (coverage map
 *      built by scanning src/lib/presets/*.json — surface.type,
 *      overlays[].type, surface.diagram[].type, annotation [style] tags in
 *      body text, checklist checked items for annotation:strike, captions
 *      cues for captions:track, and body paragraphs for block:paragraph),
 *   2. drives the flag-enabled Chrome on CDP port 9223 (same harness approach
 *      as scripts/cdp-capture.mjs): loads /p/<slug>, pauses the Timeline,
 *      pins a deterministic mid-piece frame via window.__gfxTimeline, then
 *      FOR EVERY CATALOG PACK swaps packState.slug in-page (through the
 *      app's versioned engine-state module URL; a corpus Preset's page never
 *      saves, so the scratch pack is never stored), measures each covered
 *      Pipeline's DOM region (projected through the canvas client rect into
 *      capture space), and captures the SAME frame. The Preset's authored
 *      typography.paperColor/inkColor overrides are LIFTED for all captures
 *      — see beginPackSwap — so the override ?? packRole seam resolves on
 *      the pack side (the thing being locked),
 *   3. diffs every pack pair PER PIPELINE REGION (mask = union of the two
 *      packs' measured rects, rasterized at capture scale): a non-immune
 *      Pipeline PASSes only when its own region visibly changed under EVERY
 *      pack pair; an immune Pipeline passes the INVERSE check — its region
 *      (minus occluding non-immune content layered above it) must stay
 *      under the stability ceiling, proving the declared immunity is real.
 *
 * Region attribution sources (all projected through the canvas rect, so a
 * normalized rect maps 1:1 onto capture pixels):
 *   - surface:<type>       → `.composition .surface` + descendants' rects
 *   - block:paragraph      → `.surface section > p` rects (paper/plain/newspaper)
 *   - block:<diagram type> → `[data-diagram-primitive="<id>"]` per primitive;
 *                            stroke-drawn primitives (edge-arrow /
 *                            timeline-segment) use the bbox of their resolved
 *                            endpoints (node rects / composition-space points)
 *   - annotation:<style>   → `[data-annotation-mark="<style>"]` line boxes
 *   - overlay:<type>       → `[data-overlay-id="<id>"]` + descendants
 *                            (falls back to position.rect for shader-only
 *                            overlays with no DOM box)
 *   - captions:track       → `.captions` + descendants
 * Regions are re-measured under EACH pack (a pack swap reflows layout); a
 * pair's mask is the union of both packs' rects, inflated to catch edge and
 * depth treatments that draw just outside the layout box.
 *
 * Immunity notes: an immune Pipeline's stability mask subtracts the rects of
 * non-immune Pipelines on HIGHER layers (annotations/blocks over an immune
 * surface, captions over an immune overlay) — those legitimately re-skin on
 * top of the immune artifact. Frame-level pack treatments are exempt where
 * they apply, because they restyle immune pixels by design: a pair is
 * excluded from the immunity check when the Preset declares `backgroundFill`
 * AND either pack carries a `chrome` Role (appendPackChrome), or when either
 * pack resolves a `material-treatment` recipe (the scanline raster treats
 * the merged frame in every render path) and the Surface doesn't opt out via
 * `disablePackMaterial`.
 *
 * Annotation-mark colours ARE pack-wired (`readMarkColor` in engine-state:
 * authored `marks.defaults` → the Pack's `<style>.fill` Role → mandatory core
 * accent), so `beginPackSwap` lifts authored mark defaults exactly like
 * authored typography — the annotation rows measure the Pack side of that
 * seam (mark ink itself), which also keeps them meaningful on substrate-
 * immune document surfaces (ADR-0039 §2) where the surface under the mark no
 * longer re-skins.
 *
 * Freshness: the report stores content hashes of every input that determines
 * the evidence — this script, the Pipeline/appearance source tree, each
 * catalog Pack's source directory, and each covered Preset JSON.
 *   - `--check` re-hashes everything WITHOUT Chrome and rejects the report if
 *     any source moved, a registered Pipeline has no fresh row, or the pack
 *     set drifted — the consumer-side gate for "is this evidence current?".
 *   - `--only <slugs>` re-captures a subset and MERGES into the existing
 *     report; rows whose retained evidence is stale (any source hash moved)
 *     are refused, not silently kept (this replaces the old clobber
 *     behaviour, which rewrote the whole report from a subset run).
 *
 * Coverage: a registered NON-immune Pipeline with no covering Preset is a
 * FAILURE (exit 1) — an unlocked Pipeline is exactly what this probe exists
 * to prevent. An immune Pipeline with no covering Preset is a warning (its
 * inverse check is simply unproven).
 *
 * Evidence class: this is the LOW-RES REGRESSION LOCK — captures at 25% of
 * native 4K, thresholds calibrated for that scale. It is machine evidence
 * for "the Pack reaches every Pipeline", and is NOT Calibration Trio
 * evidence: pack ratification requires native-4K captures judged at human
 * scale (docs/packs/authoring-playbook.md §5). The report says so in its
 * `evidence` block so no downstream consumer can mistake one for the other.
 *
 * Thresholds (recalibrated 2026-07-22 for per-region masks, syntax /
 * editorial-mono / crt-terminal / clean-light at 960×540):
 *   - a pixel counts as "changed" when any RGB channel moves by > 8/255;
 *   - a non-immune region PASSes a pair at ≥ 1% changed pixels within its
 *     mask. Measured across the full catalog matrix: the smallest genuine
 *     re-skin is 3.93% of its region (surface:plain body ink on
 *     watermark-demo, clean-light↔syntax); most rows measure 10–93%. The 1%
 *     floor sits ~4× under the weakest real signal;
 *   - an immune region must stay ≤ 2% changed within its mask. Measured:
 *     every immune row holds EXACTLY 0% on its non-exempt pairs; the margin
 *     absorbs AA/shadow-fringe noise where non-immune neighbours bleed past
 *     the subtracted occluders.
 *
 * Usage:
 *   npx tsx scripts/probe-pack-diff.ts                     # full catalog matrix
 *   npx tsx scripts/probe-pack-diff.ts --packs syntax,new-pack   # authoring loop
 *   npx tsx scripts/probe-pack-diff.ts --only quote-magnify      # subset, merged
 *   npx tsx scripts/probe-pack-diff.ts --plan              # coverage map, no Chrome
 *   npx tsx scripts/probe-pack-diff.ts --check             # freshness gate, no Chrome
 *
 * Captures + stats land in docs/critic-captures/pack-diff/ (committed): the
 * per-pack captures (<slug>--<pack>.png at 25% of native 4K) and
 * pack-diff-results.json with the attributable coverage matrix, per-pair
 * region stats, and source hashes. Non-zero exit on any FAIL.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PNG } from 'pngjs';

import { readGfxEnvironmentValue } from '../src/lib/utils/legacy-supers-compatibility.ts';

// The Pack manifests transitively import @fontsource side-effect stylesheets
// (`packs/syntax/fonts.ts`), which Node/tsx cannot load — stub `.css` modules
// so the registry is importable outside Vite (same pattern as verify-presets).
registerHooks({
	load(url, context, nextLoad) {
		if (url.endsWith('.css')) {
			return { format: 'module', source: '', shortCircuit: true };
		}
		return nextLoad(url, context);
	}
});

const scriptPath = fileURLToPath(import.meta.url);
const here = dirname(scriptPath);
const repoRoot = resolve(here, '..');
// The serve under measurement: the supervised production origin by default;
// a worktree's own jailed preview when authoring a pack that has not landed.
const BASE_URL = readGfxEnvironmentValue(process.env, 'GFX_BASE_URL') ?? 'http://localhost:7263';
const presetDir = resolve(repoRoot, 'src/lib/presets');
const packSourceDir = resolve(repoRoot, 'src/lib/packs');
const identityRegistryModulePath = resolve(
	repoRoot,
	'src/lib/platform/pipelines/identity-registry.ts'
);
const packRegistryModulePath = resolve(repoRoot, 'src/lib/platform/packs/registry.ts');

/**
 * The source trees whose content determines rendered Pack appearance — any
 * edit here invalidates every stored diff row. Deliberately NOT all of
 * src/lib/platform: the freshness gate should trip on appearance-bearing
 * changes (Pipeline renderers, annotation geometry, Pack resolution), not on
 * every editor tweak.
 */
const PIPELINE_TREE_ROOTS = [
	'src/lib/pipelines',
	'src/lib/platform/pipelines',
	'src/lib/platform/packs',
	'src/lib/annotations'
] as const;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
	packs: readonly string[] | null; // null = every catalog pack
	only: readonly string[] | null;
	port: number;
	regionChangedPctMin: number;
	immunityMaxPct: number;
	channelDelta: number;
	captureScale: number;
	outDir: string;
	plan: boolean;
	check: boolean;
}

function parseCli(argv: readonly string[]): CliOptions {
	const options: CliOptions = {
		packs: null,
		only: null,
		port: 9223,
		regionChangedPctMin: 1.0,
		immunityMaxPct: 2.0,
		channelDelta: 8,
		captureScale: 0.25,
		outDir: resolve(repoRoot, 'docs/critic-captures/pack-diff'),
		plan: false,
		check: false
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = (): string => {
			const value = argv[++i];
			if (value === undefined) {
				throw new Error(`Flag ${arg} expects a value`);
			}
			return value;
		};
		if (arg === '--packs') {
			const list = next()
				.split(',')
				.map((slug) => slug.trim())
				.filter((slug) => slug.length > 0);
			if (list.length < 2) {
				throw new Error('--packs expects at least two comma-separated pack slugs');
			}
			options.packs = list;
		} else if (arg === '--only') {
			options.only = next()
				.split(',')
				.map((slug) => slug.trim())
				.filter((slug) => slug.length > 0);
		} else if (arg === '--port') {
			options.port = Number(next());
		} else if (arg === '--threshold') {
			options.regionChangedPctMin = Number(next());
		} else if (arg === '--immunity-ceiling') {
			options.immunityMaxPct = Number(next());
		} else if (arg === '--channel-delta') {
			options.channelDelta = Number(next());
		} else if (arg === '--scale') {
			options.captureScale = Number(next());
		} else if (arg === '--outdir') {
			options.outDir = resolve(process.cwd(), next());
		} else if (arg === '--plan') {
			options.plan = true;
		} else if (arg === '--check') {
			options.check = true;
		} else {
			throw new Error(`Unknown flag: ${arg}`);
		}
	}

	return options;
}

const cli = parseCli(process.argv.slice(2));

/**
 * Mask inflation (fractions of the capture's min dimension): rects are grown
 * before rasterizing so edge/depth treatments drawn just outside the layout
 * box (stepped shadows, torn edges, stroke overshoot) stay inside the mask.
 * Annotations get more room — marks (circle, box, side-note rules) draw
 * around their anchor span, not inside it.
 */
const REGION_INFLATE_FRAC = 0.012;
const ANNOTATION_INFLATE_FRAC = 0.03;

// ---------------------------------------------------------------------------
// Registry import (tsx resolves $lib; CSS is stubbed above)
// ---------------------------------------------------------------------------

const { IDENTITY_REGISTRY, PACK_IMMUNE_PIPELINE_KEYS } = (await import(
	pathToFileURL(identityRegistryModulePath).href
)) as {
	IDENTITY_REGISTRY: Readonly<Record<string, unknown>>;
	PACK_IMMUNE_PIPELINE_KEYS: readonly string[];
};

const { PACK_REGISTRY } = (await import(pathToFileURL(packRegistryModulePath).href)) as {
	PACK_REGISTRY: Readonly<
		Record<string, { slug: string; roles: Readonly<Record<string, { kind: string }>> }>
	>;
};

const { resolveMaterialTreatment } = (await import(
	pathToFileURL(resolve(repoRoot, 'src/lib/platform/packs/resolve.ts')).href
)) as {
	resolveMaterialTreatment: (manifest: unknown) => unknown;
};

const registeredPipelineKeys = Object.keys(IDENTITY_REGISTRY);
const immuneKeys = new Set(PACK_IMMUNE_PIPELINE_KEYS);
const catalogPacks = [...(cli.packs ?? Object.keys(PACK_REGISTRY))].sort();

for (const pack of catalogPacks) {
	if (!(pack in PACK_REGISTRY)) {
		console.error(
			`Unknown pack "${pack}" — registered packs: ${Object.keys(PACK_REGISTRY).join(', ')}`
		);
		process.exit(2);
	}
}

/** Pack slugs whose manifest carries a `chrome` Role (applies only over backgroundFill). */
const chromePacks = new Set(
	catalogPacks.filter((slug) =>
		Object.values(PACK_REGISTRY[slug].roles).some((role) => role.kind === 'chrome')
	)
);

/**
 * Pack slugs whose `material-treatment` resolves to a frame-level recipe
 * (crt-terminal's scanline raster). Unlike chrome, material treats the merged
 * frame in EVERY render path — transparent overlays included — so it
 * legitimately rides on top of Pack-immune artifacts (see
 * buildShaderPassDispatchList in composition-frame-renderer.ts).
 */
const materialPacks = new Set(
	catalogPacks.filter((slug) => resolveMaterialTreatment(PACK_REGISTRY[slug]) !== null)
);

/**
 * A Surface renderer can opt the whole frame out of pack material
 * (`disablePackMaterial` — website-screenshot's verisimilar display). The
 * renderer registry imports Svelte CanvasSources and cannot load under tsx,
 * so the flag is read from the renderer module source directly.
 */
function surfaceDisablesPackMaterial(surfaceType: string): boolean {
	const indexPath = resolve(repoRoot, 'src/lib/pipelines/surfaces', surfaceType, 'index.ts');
	return (
		existsSync(indexPath) && /disablePackMaterial:\s*true/.test(readFileSync(indexPath, 'utf8'))
	);
}

// ---------------------------------------------------------------------------
// Source hashes — the freshness contract
// ---------------------------------------------------------------------------

function sha256Bytes(bytes: Buffer | string): string {
	return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

function sha256File(path: string): string {
	return sha256Bytes(readFileSync(path));
}

function sha256Tree(rootDirs: readonly string[]): string {
	const files: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else {
				files.push(full);
			}
		}
	};
	for (const root of rootDirs) {
		walk(root);
	}
	files.sort();
	const hash = createHash('sha256');
	for (const file of files) {
		hash.update(relative(repoRoot, file));
		hash.update('\0');
		hash.update(readFileSync(file));
		hash.update('\0');
	}
	return hash.digest('hex').slice(0, 16);
}

interface SourceHashes {
	script: string;
	pipelinesTree: string;
	packs: Record<string, string>;
	presets: Record<string, string>;
}

function computeGlobalSourceHashes(): Omit<SourceHashes, 'presets'> {
	return {
		script: sha256File(scriptPath),
		pipelinesTree: sha256Tree(PIPELINE_TREE_ROOTS.map((root) => resolve(repoRoot, root))),
		packs: Object.fromEntries(
			catalogPacks.map((slug) => [slug, sha256Tree([resolve(packSourceDir, slug)])])
		)
	};
}

function presetFileHash(slug: string): string | null {
	const path = resolve(presetDir, `${slug}.json`);
	return existsSync(path) ? sha256File(path) : null;
}

// ---------------------------------------------------------------------------
// Coverage map — scan the corpus for which Preset exercises which Pipeline
// ---------------------------------------------------------------------------

interface PresetScan {
	slug: string;
	kind: string | undefined;
	pack: string;
	orientation: string;
	surfaceType: string | null;
	hasBackgroundFill: boolean;
	covers: ReadonlySet<string>;
}

const annotationStyles = registeredPipelineKeys
	.filter((key) => key.startsWith('annotation:'))
	.map((key) => key.slice('annotation:'.length));

/** Surfaces whose non-empty `content.body` renders through block:paragraph. */
const PARAGRAPH_BODY_SURFACES = new Set(['paper', 'plain', 'newspaper']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scanPreset(slug: string, json: unknown): PresetScan | null {
	if (!isRecord(json) || !isRecord(json.state)) {
		return null;
	}
	const state = json.state;
	const covers = new Set<string>();

	const surface = isRecord(state.surface) ? state.surface : null;
	const surfaceType = surface && typeof surface.type === 'string' ? surface.type : null;
	if (surfaceType) {
		covers.add(`surface:${surfaceType}`);
	}

	if (Array.isArray(state.overlays)) {
		for (const overlay of state.overlays) {
			if (isRecord(overlay) && typeof overlay.type === 'string') {
				covers.add(`overlay:${overlay.type}`);
			}
		}
	}

	if (surface && Array.isArray(surface.diagram)) {
		for (const primitive of surface.diagram) {
			if (isRecord(primitive) && typeof primitive.type === 'string') {
				covers.add(`block:${primitive.type}`);
			}
		}
	}

	// Annotation marks ride inline [style]…[/style] tags in body text (paper /
	// plain / newspaper bodies and web-document / imessage message bodies alike).
	const serialized = JSON.stringify(json);
	for (const style of annotationStyles) {
		if (serialized.includes(`[${style}]`)) {
			covers.add(`annotation:${style}`);
		}
	}

	// block:paragraph has no JSON `type` of its own — body paragraphs on the
	// text surfaces render through the paragraph Block pipeline.
	if (surface && surfaceType && PARAGRAPH_BODY_SURFACES.has(surfaceType)) {
		const content = isRecord(surface.content) ? surface.content : null;
		const body = content?.body;
		const hasBody =
			(typeof body === 'string' && body.trim().length > 0) ||
			(Array.isArray(body) && body.length > 0);
		if (hasBody) {
			covers.add('block:paragraph');
		}
	}

	// Checklist checked items render a data-annotation-mark="strike" span and
	// draw through the reused strike Annotation (ADR-0040) — no [strike] tag
	// appears in the JSON, so detect coverage from the items themselves.
	if (surface && surfaceType === 'checklist') {
		const content = isRecord(surface.content) ? surface.content : null;
		const items = content && Array.isArray(content.items) ? content.items : [];
		if (items.some((item) => isRecord(item) && item.checked === true)) {
			covers.add('annotation:strike');
		}
	}

	// Captions cues render through the captions track Pipeline.
	const captions = isRecord(state.captions) ? state.captions : null;
	if (captions && Array.isArray(captions.cues) && captions.cues.length > 0) {
		covers.add('captions:track');
	}

	if (typeof json.pack !== 'string' || json.pack.trim().length === 0) {
		throw new Error(`Preset "${slug}" is missing its required Pack.`);
	}

	return {
		slug,
		kind: typeof json.kind === 'string' ? json.kind : undefined,
		pack: json.pack,
		orientation:
			isRecord(state.transport) && typeof state.transport.orientation === 'string'
				? state.transport.orientation
				: 'horizontal',
		surfaceType,
		hasBackgroundFill: state.backgroundFill !== undefined && state.backgroundFill !== null,
		covers
	};
}

const presetScans: PresetScan[] = [];
for (const file of readdirSync(presetDir).filter((name) => name.endsWith('.json'))) {
	const slug = file.replace(/\.json$/, '');
	const parsed: unknown = JSON.parse(readFileSync(resolve(presetDir, file), 'utf8'));
	const scan = scanPreset(slug, parsed);
	if (scan) {
		presetScans.push(scan);
	}
}
const scanBySlug = new Map(presetScans.map((scan) => [scan.slug, scan]));

/**
 * Hand-picked representatives where the deterministic scoring below would pick
 * a Preset that covers the Pipeline but doesn't showcase it (the lower-third's
 * cinematic variant exercises the plate/scrim/flare Roles; the DOF presets
 * merely carry a lower-third in the background). watermark-channel-sig is
 * transparent, so the authored-ink LIFT applies and the watermark's pack
 * response is measurable — on the scoring's pick (text-3d-cylinder, a
 * backgroundFill piece) the authored ink stays and masks it. The same logic
 * picks watermark-demo for surface:plain: the scoring's pick
 * (docu-flowchart) is a backgroundFill piece whose plain field is authored
 * background with no body, so the surface region has nothing pack-responsive
 * in it. captions:track must be evidenced by the `pack` caption style — the
 * karaoke/word-pop styles are deliberately pack-independent (the faithful
 * social register) and can never diff.
 */
const REPRESENTATIVE_OVERRIDES: Readonly<Record<string, string>> = {
	'overlay:lower-third': 'lower-third',
	'overlay:watermark': 'watermark-channel-sig',
	'surface:plain': 'watermark-demo',
	'captions:track': 'captions-pack-style-demo',
	// Substrate immunity (ADR-0039 §2 → ADR-0056) recalibrations: the newspaper
	// is now a fully immune photographed page, so its row sits in the
	// stability set with no override. block:paragraph and annotation:highlight
	// lost their document-surface bleed-through evidence (the body no longer
	// re-skins) and live on plain-surface presets where the ink they ride is
	// genuinely claimable.
	'block:paragraph': 'watermark-demo',
	'annotation:highlight': 'keyframes-cascade-demo'
};

/**
 * Per-Preset frame choice (Timeline progress 0..1) — the frame all captures
 * pin. Default is 0.5 (mid-piece: enters settled, exits not started). Override
 * where a covered Pipeline isn't fully on-frame at 0.5:
 *   - research-paper-critique: its third mark (circle) draws at 0.60–0.70, so
 *     0.75 is the first mid-piece frame with all three annotation styles
 *     (highlight / underline / circle) fully drawn.
 */
const PRESET_PROGRESS: Readonly<Record<string, number>> = {
	'research-paper-critique': 0.75
};
const DEFAULT_PROGRESS = 0.5;

function pickRepresentative(pipelineKey: string): PresetScan | null {
	const override = REPRESENTATIVE_OVERRIDES[pipelineKey];
	if (override) {
		const scan = scanBySlug.get(override);
		if (!scan || !scan.covers.has(pipelineKey)) {
			throw new Error(
				`REPRESENTATIVE_OVERRIDES["${pipelineKey}"] = "${override}" does not cover that pipeline`
			);
		}
		return scan;
	}

	const candidates = presetScans.filter((entry) => entry.covers.has(pipelineKey));
	if (candidates.length === 0) {
		return null;
	}
	// Prefer deliverables over fixtures, horizontal over vertical (one aspect to
	// eyeball), then the Preset covering the most Pipelines (fewer captures
	// overall), then alphabetical for determinism.
	candidates.sort((a, b) => {
		const fixtureRank = Number(a.kind === 'fixture') - Number(b.kind === 'fixture');
		if (fixtureRank !== 0) return fixtureRank;
		const orientationRank =
			Number(a.orientation !== 'horizontal') - Number(b.orientation !== 'horizontal');
		if (orientationRank !== 0) return orientationRank;
		if (a.covers.size !== b.covers.size) return b.covers.size - a.covers.size;
		return a.slug.localeCompare(b.slug);
	});
	return candidates[0];
}

type CoverageStatus = 'covered' | 'immune-covered' | 'gap' | 'immune-gap';

interface CoverageEntry {
	pipeline: string;
	status: CoverageStatus;
	preset: string | null;
	progress: number | null;
}

const coverage: CoverageEntry[] = registeredPipelineKeys.map((pipelineKey) => {
	const immune = immuneKeys.has(pipelineKey);
	const representative = pickRepresentative(pipelineKey);
	if (!representative) {
		return {
			pipeline: pipelineKey,
			status: immune ? 'immune-gap' : 'gap',
			preset: null,
			progress: null
		};
	}
	return {
		pipeline: pipelineKey,
		status: immune ? 'immune-covered' : 'covered',
		preset: representative.slug,
		progress: PRESET_PROGRESS[representative.slug] ?? DEFAULT_PROGRESS
	};
});

// Deduped capture jobs.
interface CaptureJob {
	slug: string;
	progress: number;
	pipelines: string[];
}

const jobsBySlug = new Map<string, CaptureJob>();
for (const entry of coverage) {
	if (entry.preset === null || entry.progress === null) {
		continue;
	}
	const existing = jobsBySlug.get(entry.preset);
	if (existing) {
		existing.pipelines.push(entry.pipeline);
	} else {
		jobsBySlug.set(entry.preset, {
			slug: entry.preset,
			progress: entry.progress,
			pipelines: [entry.pipeline]
		});
	}
}
const jobs = [...jobsBySlug.values()]
	.filter((job) => cli.only === null || cli.only.includes(job.slug))
	.sort((a, b) => a.slug.localeCompare(b.slug));

// ---------------------------------------------------------------------------
// Report shapes (written to pack-diff-results.json, read back by --check and
// by --only merges)
// ---------------------------------------------------------------------------

interface PairRegionStats {
	changedPct: number;
	meanAbsDiff: number;
	maskPx: number;
	exempt?: 'chrome' | 'material';
}

interface PipelineRegionReport {
	maskPctOfFrame: number;
	hiddenUnderPacks: string[];
	pairs: Record<string, PairRegionStats>;
}

interface PresetReportEntry {
	slug: string;
	progress: number;
	timelineTime: number;
	packs: string[];
	presetSha256: string;
	captures: Record<string, string>;
	frame: { width: number; height: number };
	frameDiff: Record<string, { changedPct: number }>;
	pipelines: Record<string, PipelineRegionReport>;
	error: string | null;
}

interface PackDiffReport {
	generatedAt: string;
	evidence: { class: string; note: string };
	packs: string[];
	thresholds: {
		regionChangedPctMin: number;
		immunityMaxPct: number;
		perChannelDelta: number;
		captureScale: number;
		regionInflateFrac: number;
		annotationInflateFrac: number;
	};
	sources: SourceHashes;
	coverage: CoverageRow[];
	presets: PresetReportEntry[];
}

interface CoverageRow {
	pipeline: string;
	preset: string;
	status: string;
	maskPctOfFrame: string;
	worstPair: string;
	detail: string;
}

const EVIDENCE_BLOCK = {
	class: 'low-res-regression-lock',
	note: `Per-Pipeline masked pack-pair diffs at ${cli.captureScale * 100}% of native 4K. Machine regression evidence only — NOT native-4K Calibration Trio evidence; pack ratification needs full-resolution captures judged at human scale (docs/packs/authoring-playbook.md §5).`
} as const;

const summaryPath = resolve(cli.outDir, 'pack-diff-results.json');

function loadExistingReport(): PackDiffReport | null {
	if (!existsSync(summaryPath)) {
		return null;
	}
	const parsed: unknown = JSON.parse(readFileSync(summaryPath, 'utf8'));
	if (!isRecord(parsed) || !Array.isArray(parsed.presets) || !isRecord(parsed.sources)) {
		return null; // pre-attributable report shape — treat as absent
	}
	return parsed as unknown as PackDiffReport;
}

// ---------------------------------------------------------------------------
// --plan: print the coverage map and job list without touching Chrome
// ---------------------------------------------------------------------------

if (cli.plan) {
	console.log(
		`Catalog packs: ${catalogPacks.join(', ')} (chrome: ${[...chromePacks].join(', ') || 'none'})`
	);
	console.log('');
	for (const entry of coverage) {
		console.log(
			`${entry.pipeline.padEnd(28)} ${entry.status.padEnd(15)} ${entry.preset ?? '—'}${entry.progress !== null ? ` @ p=${entry.progress}` : ''}`
		);
	}
	console.log('');
	console.log(`${jobs.length} capture job(s): ${jobs.map((job) => job.slug).join(', ')}`);
	process.exit(0);
}

// ---------------------------------------------------------------------------
// --check: freshness + completeness gate over the stored report (no Chrome)
// ---------------------------------------------------------------------------

if (cli.check) {
	const report = loadExistingReport();
	const problems: string[] = [];
	if (report === null) {
		console.error(`✗ No attributable pack-diff report at ${summaryPath} — run the probe first.`);
		process.exit(1);
	}

	const globals = computeGlobalSourceHashes();
	if (report.sources.script !== globals.script) {
		problems.push('probe script changed since the report was generated');
	}
	if (report.sources.pipelinesTree !== globals.pipelinesTree) {
		problems.push('Pipeline/appearance source tree changed since the report was generated');
	}
	if ([...report.packs].sort().join(',') !== catalogPacks.join(',')) {
		problems.push(
			`pack set drifted: report has [${report.packs.join(', ')}], catalog is [${catalogPacks.join(', ')}]`
		);
	} else {
		for (const pack of catalogPacks) {
			if (report.sources.packs[pack] !== globals.packs[pack]) {
				problems.push(`pack "${pack}" sources changed since the report was generated`);
			}
		}
	}
	for (const [slug, storedHash] of Object.entries(report.sources.presets)) {
		const current = presetFileHash(slug);
		if (current === null) {
			problems.push(`covered preset "${slug}" no longer exists`);
		} else if (current !== storedHash) {
			problems.push(`covered preset "${slug}" changed since the report was generated`);
		}
	}

	const rowByPipeline = new Map(report.coverage.map((row) => [row.pipeline, row]));
	for (const pipelineKey of registeredPipelineKeys) {
		const row = rowByPipeline.get(pipelineKey);
		if (!row) {
			problems.push(
				`registered pipeline "${pipelineKey}" has no row in the report (stale registry)`
			);
			continue;
		}
		if (row.status !== 'PASS' && row.status !== 'IMMUNE-PASS' && row.status !== 'IMMUNE-GAP') {
			problems.push(`pipeline "${pipelineKey}" row is not passing: ${row.status} (${row.detail})`);
		}
	}
	for (const row of report.coverage) {
		if (!registeredPipelineKeys.includes(row.pipeline)) {
			problems.push(`report row "${row.pipeline}" is not a registered pipeline (stale registry)`);
		}
	}

	if (problems.length > 0) {
		console.error(`✗ pack-diff report REJECTED (${problems.length} problem(s)):`);
		for (const problem of problems) {
			console.error(`  - ${problem}`);
		}
		console.error('  Re-run: npx tsx scripts/probe-pack-diff.ts');
		process.exit(1);
	}
	console.log(
		`✓ pack-diff report is fresh: ${report.packs.length} packs × ${registeredPipelineKeys.length} pipelines, generated ${report.generatedAt}.`
	);
	process.exit(0);
}

// ---------------------------------------------------------------------------
// CDP plumbing (same connection + native-canvas capture approach as
// scripts/cdp-capture.mjs — flag-enabled Chrome on the debug port)
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface CdpTarget {
	type: string;
	webSocketDebuggerUrl?: string;
}

async function getTarget(port: number): Promise<CdpTarget & { webSocketDebuggerUrl: string }> {
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			const res = await fetch(`http://localhost:${port}/json`);
			const targets = (await res.json()) as CdpTarget[];
			const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
			if (page?.webSocketDebuggerUrl) {
				return page as CdpTarget & { webSocketDebuggerUrl: string };
			}
		} catch {
			// Chrome not up yet; retry.
		}
		await sleep(500);
	}
	throw new Error(
		`Chrome not reachable on CDP port ${port} — launch it with scripts/launch-cdp-chrome.sh`
	);
}

interface CdpMessage {
	id?: number;
	error?: unknown;
	result?: unknown;
}

class CdpSession {
	#ws: WebSocket;
	#nextId = 1;
	#pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();

	private constructor(ws: WebSocket) {
		this.#ws = ws;
		ws.onmessage = (event: MessageEvent) => {
			const msg = JSON.parse(String(event.data)) as CdpMessage;
			if (msg.id !== undefined && this.#pending.has(msg.id)) {
				const entry = this.#pending.get(msg.id);
				this.#pending.delete(msg.id);
				if (msg.error) entry?.reject(new Error(JSON.stringify(msg.error)));
				else entry?.resolve(msg.result);
			}
		};
	}

	static async connect(url: string): Promise<CdpSession> {
		const ws = new WebSocket(url);
		await new Promise<void>((res, rej) => {
			ws.onopen = () => res();
			ws.onerror = () => rej(new Error(`WebSocket connect failed: ${url}`));
		});
		return new CdpSession(ws);
	}

	send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
		const id = this.#nextId++;
		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			this.#ws.send(JSON.stringify({ id, method, params }));
		});
	}

	async evaluate<T>(expression: string): Promise<T> {
		const result = (await this.send('Runtime.evaluate', {
			expression,
			returnByValue: true,
			awaitPromise: true
		})) as { exceptionDetails?: { text: string }; result: { value: T } };
		if (result.exceptionDetails) {
			throw new Error(`Page evaluate failed: ${result.exceptionDetails.text}`);
		}
		return result.result.value;
	}

	close(): void {
		this.#ws.close();
	}
}

interface CanvasRect {
	x: number;
	y: number;
	w: number;
	h: number;
	bw: number;
	bh: number;
}

async function waitReady(session: CdpSession, slug: string): Promise<void> {
	// The PREVIOUS page also has a canvas + timeline, so readiness must be
	// pinned to the expected route or a slow navigation captures the old page.
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			const state = await session.evaluate<{
				onRoute: boolean;
				canvas: boolean;
				timeline: boolean;
			}>(
				`(() => ({
					onRoute: location.pathname === ${JSON.stringify(`/p/${slug}`)},
					canvas: !!document.querySelector('canvas'),
					timeline: !!window.__gfxTimeline
				}))()`
			);
			if (state.onRoute && state.canvas && state.timeline) {
				return;
			}
		} catch {
			// Mid-navigation; retry.
		}
		await sleep(500);
	}
	throw new Error(`App did not become ready on /p/${slug} (route + canvas + window.__gfxTimeline)`);
}

/** Pause + seek deterministically; confirm the playhead landed (cdp-capture's loop). */
async function pinFrame(session: CdpSession, progress: number): Promise<number> {
	let landed = -1;
	for (let attempt = 0; attempt < 20; attempt++) {
		landed = await session.evaluate<number>(
			`(() => {
				const t = window.__gfxTimeline;
				t.pause();
				t.seekProgress(${progress});
				return t.time;
			})()`
		);
		await sleep(120);
		const { time, expected } = await session.evaluate<{ time: number; expected: number }>(
			`(() => {
				const t = window.__gfxTimeline;
				return { time: t.time, expected: ${progress} * t.durationSeconds };
			})()`
		);
		if (Math.abs(time - expected) < 0.05) {
			return time;
		}
	}
	return landed;
}

async function captureCanvas(
	session: CdpSession,
	rect: CanvasRect,
	scale: number,
	outPath: string
): Promise<void> {
	// On-surface capture clipped to the canvas (never the page/editor chrome).
	// NO captureBeyondViewport — it re-rasters without the accelerated WebGPU
	// layer and yields a blank canvas. Clip height derives from the BACKING
	// aspect (see cdp-capture.mjs). `scale` down-samples from native 4K.
	const clipScale = rect.w > 0 ? rect.bw / rect.w : 1;
	const shot = (await session.send('Page.captureScreenshot', {
		format: 'png',
		fromSurface: true,
		clip: {
			x: rect.x,
			y: rect.y,
			width: rect.w,
			height: rect.bh / clipScale,
			scale: clipScale * scale
		}
	})) as { data: string };
	writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
}

// ---------------------------------------------------------------------------
// In-page pack swap — versioned module URL + autosave suppression
// ---------------------------------------------------------------------------

/**
 * Import engine-state through the URL the app itself loaded (Vite versions
 * invalidated modules with ?t=; a bare dynamic import can resolve to a
 * SECOND module instance whose writes the app never sees). The swap needs no
 * autosave bracket: this probe runs on a corpus Preset's own page, which never
 * saves (ADR-0068 §3).
 *
 * The window also LIFTS the Preset's authored `typography.paperColor` /
 * `inkColor`. Under ADR-0038 an authored colour is an explicit override that
 * WINS over the Pack, and nearly the whole corpus authors paper+ink — so
 * with the overrides in place a correctly-wired text pipeline legitimately
 * renders identical pixels under two Packs and proves nothing. Lifting them
 * for all captures makes the `override ?? packRole` seam resolve on the
 * pack side, which is exactly the buy-in this lock verifies. EXCEPTION: on
 * full-frame pieces (`backgroundFill` set) the authored ink is load-bearing
 * for legibility (light ink on a dark field — the catalog's core inks are
 * dark, so lifting makes every stroke invisible and zeroes a real structural
 * diff); there the overrides stay and pack response rides the structural
 * Roles (stroke/plate/accent/fill). Everything is restored in endPackSwap.
 */
async function beginPackSwap(session: CdpSession): Promise<string> {
	const result = await session.evaluate<{ ownSlug: string; moduleUrl: string }>(
		`(async () => {
			const names = performance
				.getEntriesByType('resource')
				.map((entry) => entry.name)
				.filter((name) => name.includes('engine-state.svelte.ts'));
			if (names.length === 0) {
				throw new Error('engine-state.svelte.ts not in the resource-timing buffer — cannot import the app module instance');
			}
			const url = names[names.length - 1];
			const mod = await import(url);
			const state = mod.engineState;
			const lift = state.backgroundFill === undefined || state.backgroundFill === null;
			const saved = {
				lift,
				paperColor: state.typography.paperColor,
				inkColor: state.typography.inkColor,
				markDefaults: state.marks.defaults,
				timingColors: state.marks.timings.map((timing) => timing.color)
			};
			if (lift) {
				state.typography.paperColor = undefined;
				state.typography.inkColor = undefined;
				// Authored mark colours mask the pack exactly like authored
				// typography: the render chain is timing.color ?? defaults.color ??
				// the Pack's <style>.fill Role -> core accent (readMarkColor), so
				// BOTH authored tiers are lifted and the annotation rows measure the
				// Pack side of that seam (the thing being locked) instead of a
				// composition constant. Same transparent-piece-only condition as the
				// typography lift, restored in endPackSwap.
				state.marks.defaults = {};
				for (const timing of state.marks.timings) {
					timing.color = undefined;
				}
			}
			window.__packDiff = { mod, originalSlug: mod.packState.slug, saved };
			return { ownSlug: mod.packState.slug, moduleUrl: url };
		})()`
	);
	return result.ownSlug;
}

async function setPack(session: CdpSession, slug: string): Promise<void> {
	const applied = await session.evaluate<string>(
		`(async () => {
			const pd = window.__packDiff;
			pd.mod.packState.slug = ${JSON.stringify(slug)};
			await document.fonts.ready;
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			return pd.mod.packState.slug;
		})()`
	);
	if (applied !== slug) {
		throw new Error(`Pack swap did not stick: expected "${slug}", app reads "${applied}"`);
	}
	// Let the pack-tracking render $effect re-capture the DOM and composite
	// (uploadDom + tick) before screenshotting.
	await sleep(800);
}

/**
 * Fingerprint the appearance vars at the exact injection sites (the
 * SurfaceMount display:contents wrapper, overlay mount items, diagram mount
 * items — the elements `resolveAppearanceVars` styles). Sampled under each
 * pack: when the packs differ but this fingerprint never does, the swap never
 * reached the app's DOM (e.g. a duplicate engine-state module instance) and a
 * zero pixel diff would be a harness artifact, not a pipeline verdict — fail
 * the job instead. Immune mounts skip injection, so a preset covering only
 * immune pipelines legitimately fingerprints empty and the guard stands down.
 */
async function sampleAppearanceVars(session: CdpSession): Promise<string> {
	return session.evaluate<string>(
		`(() => {
			const samples = [];
			const surfaceEl = document.querySelector('.composition .surface');
			const sites = [
				surfaceEl ? surfaceEl.parentElement : null,
				...document.querySelectorAll('[data-overlay-id], .diagram-mount__item')
			];
			for (const node of sites) {
				const style = node ? node.getAttribute('style') : null;
				if (style && style.includes('--')) {
					samples.push(style);
					if (samples.length >= 8) break;
				}
			}
			return samples.join('|');
		})()`
	);
}

async function endPackSwap(session: CdpSession): Promise<void> {
	await session.evaluate<boolean>(
		`(async () => {
			const pd = window.__packDiff;
			if (!pd) return false;
			const state = pd.mod.engineState;
			if (pd.saved.lift) {
				state.typography.paperColor = pd.saved.paperColor;
				state.typography.inkColor = pd.saved.inkColor;
				state.marks.defaults = pd.saved.markDefaults;
				for (let i = 0; i < state.marks.timings.length; i++) {
					state.marks.timings[i].color = pd.saved.timingColors[i];
				}
			}
			pd.mod.packState.slug = pd.originalSlug;
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			delete window.__packDiff;
			return true;
		})()`
	);
}

// ---------------------------------------------------------------------------
// In-page region measurement — projects every covered Pipeline's DOM onto the
// canvas client rect (the exact clip the capture uses), normalized 0..1
// ---------------------------------------------------------------------------

type NormalizedRect = readonly [number, number, number, number]; // x, y, w, h

interface RegionMeasurement {
	regions: Record<string, NormalizedRect[]>;
	hidden: Record<string, boolean>;
}

async function measureRegions(session: CdpSession): Promise<RegionMeasurement> {
	const expression = `(() => {
		const pd = window.__packDiff;
		const state = pd.mod.engineState;
		// Project against the frame-sized .composition, NOT the canvas client
		// rect: the DOM inside the canvas layoutsubtree reports UNTRANSFORMED
		// coordinates (.composition measures 3840×2160 CSS px while the canvas
		// displays at a few hundred), and the composition maps 1:1 onto the
		// canvas backing — so composition-normalized rects land exactly on
		// capture pixels.
		const comp = document.querySelector('.composition');
		if (!comp) throw new Error('.composition not found — cannot project regions');
		const ref = comp.getBoundingClientRect();
		const compRect = ref;
		const ANNOTATION_STYLES = ${JSON.stringify(annotationStyles)};
		const PARAGRAPH_SURFACES = ${JSON.stringify([...PARAGRAPH_BODY_SURFACES])};
		const regions = {};
		const hidden = {};
		const norm = (r) => [
			(r.left - ref.left) / ref.width,
			(r.top - ref.top) / ref.height,
			r.width / ref.width,
			r.height / ref.height
		].map((v) => Math.round(v * 10000) / 10000);
		const push = (list, r) => {
			if (r && r.width > 1 && r.height > 1) list.push(norm(r));
		};
		// A layout container that paints nothing (transparent, borderless, no
		// direct text) must not claim its rect — the plain surface's frame-sized
		// transparent root would otherwise dilute the region to the whole frame.
		const paintsSomething = (el) => {
			if (/^(IMG|SVG|CANVAS|VIDEO|PICTURE)$/i.test(el.tagName)) return true;
			const cs = getComputedStyle(el);
			if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') return true;
			if (cs.backgroundImage !== 'none') return true;
			if (cs.boxShadow !== 'none') return true;
			if (
				parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderRightWidth) > 0 ||
				parseFloat(cs.borderBottomWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0
			) return true;
			for (const child of el.childNodes) {
				if (child.nodeType === 3 && child.textContent.trim().length > 0) return true;
			}
			return false;
		};
		const collectTree = (rootEl, cap) => {
			const painted = [];
			const all = [];
			if (!rootEl) return painted;
			if (paintsSomething(rootEl)) push(painted, rootEl.getBoundingClientRect());
			push(all, rootEl.getBoundingClientRect());
			let n = 0;
			for (const el of rootEl.querySelectorAll('*')) {
				if (++n > (cap ?? 300)) break;
				if (paintsSomething(el)) push(painted, el.getBoundingClientRect());
				push(all, el.getBoundingClientRect());
			}
			// Nothing qualifies as painted (a shader draws into a sized empty box,
			// e.g. shader-fill) — the layout rects ARE the region.
			return painted.length > 0 ? painted : all;
		};

		// Surface — the CanvasSource root + everything it lays out.
		const surfaceEl = document.querySelector('.composition .surface');
		regions['surface:' + state.surface.type] = collectTree(surfaceEl);

		// block:paragraph — body paragraphs on the text surfaces.
		if (PARAGRAPH_SURFACES.includes(state.surface.type)) {
			const rects = [];
			for (const p of document.querySelectorAll('.composition .surface section > p')) {
				push(rects, p.getBoundingClientRect());
			}
			if (rects.length > 0) regions['block:paragraph'] = rects;
		}

		// Diagram Blocks — DOM mounts by primitive id; stroke-drawn primitives
		// (edge-arrow / timeline-segment) get the bbox of their resolved
		// endpoints (node rects or composition-space fraction points).
		const diagram = Array.isArray(state.surface.diagram) ? state.surface.diagram : [];
		const primitiveRect = (id) => {
			const el = document.querySelector('[data-diagram-primitive="' + CSS.escape(id) + '"]');
			return el ? el.getBoundingClientRect() : null;
		};
		const pointRect = (pt) => ({
			left: compRect.left + pt.x * compRect.width,
			top: compRect.top + pt.y * compRect.height,
			width: 2,
			height: 2
		});
		for (const primitive of diagram) {
			const key = 'block:' + primitive.type;
			const rects = (regions[key] = regions[key] ?? []);
			if (primitive.type === 'edge-arrow' || primitive.type === 'timeline-segment') {
				const ends = [primitive.from, primitive.to, primitive.control]
					.filter(Boolean)
					.map((end) => (end.node !== undefined ? primitiveRect(end.node) : pointRect(end)))
					.filter(Boolean);
				if (ends.length > 0) {
					const left = Math.min(...ends.map((r) => r.left));
					const top = Math.min(...ends.map((r) => r.top));
					const right = Math.max(...ends.map((r) => r.left + r.width));
					const bottom = Math.max(...ends.map((r) => r.top + r.height));
					push(rects, { left, top, width: right - left, height: bottom - top });
				}
				const own = primitiveRect(primitive.id); // labeled timeline segments have DOM too
				if (own) push(rects, own);
			} else {
				const own = primitiveRect(primitive.id);
				if (own) push(rects, own);
			}
		}

		// Annotations — the anchor spans' line boxes (marks draw around them).
		for (const style of ANNOTATION_STYLES) {
			const spans = document.querySelectorAll('[data-annotation-mark="' + style + '"]');
			if (spans.length === 0) continue;
			const rects = [];
			for (const span of spans) {
				for (const lineBox of span.getClientRects()) push(rects, lineBox);
			}
			if (rects.length > 0) regions['annotation:' + style] = rects;
		}

		// Overlays — the positioned mount + descendants; shader-only overlays
		// with no DOM box fall back to their authored normalized rect.
		for (const overlay of state.overlays) {
			const key = 'overlay:' + overlay.type;
			const rects = (regions[key] = regions[key] ?? []);
			const mount = document.querySelector('[data-overlay-id="' + CSS.escape(overlay.id) + '"]');
			if (!mount) continue;
			const collected = collectTree(mount);
			if (collected.length > 0) {
				rects.push(...collected);
			} else if (overlay.position && overlay.position.rect) {
				const r = overlay.position.rect;
				const cx = compRect.left + r.x * compRect.width;
				const cy = compRect.top + r.y * compRect.height;
				push(rects, { left: cx, top: cy, width: r.width * compRect.width, height: r.height * compRect.height });
			}
			const opacity = Number(getComputedStyle(mount).opacity);
			if (Number.isFinite(opacity) && opacity < 0.05) hidden[key] = true;
		}

		// Captions — topmost track.
		if (state.captions && Array.isArray(state.captions.cues) && state.captions.cues.length > 0) {
			const captionsEl = document.querySelector('.captions');
			regions['captions:track'] = collectTree(captionsEl);
		}

		return { regions, hidden };
	})()`;
	return session.evaluate<RegionMeasurement>(expression);
}

// ---------------------------------------------------------------------------
// Masked pixel diff
// ---------------------------------------------------------------------------

function inflateFracFor(pipelineKey: string): number {
	return pipelineKey.startsWith('annotation:') ? ANNOTATION_INFLATE_FRAC : REGION_INFLATE_FRAC;
}

/**
 * Render layer order for immune-mask occluder subtraction: content on a
 * HIGHER layer legitimately re-skins on top of an immune artifact below it.
 */
function layerOfPipelineKey(pipelineKey: string): number {
	if (pipelineKey.startsWith('surface:')) return 0;
	if (pipelineKey.startsWith('block:') || pipelineKey.startsWith('annotation:')) return 1;
	if (pipelineKey.startsWith('overlay:')) return 2;
	return 3; // captions ride topmost
}

function paintRects(
	mask: Uint8Array,
	rects: readonly NormalizedRect[],
	width: number,
	height: number,
	inflatePx: number,
	value: 0 | 1
): void {
	for (const [nx, ny, nw, nh] of rects) {
		const x0 = Math.max(0, Math.floor(nx * width - inflatePx));
		const y0 = Math.max(0, Math.floor(ny * height - inflatePx));
		const x1 = Math.min(width, Math.ceil((nx + nw) * width + inflatePx));
		const y1 = Math.min(height, Math.ceil((ny + nh) * height + inflatePx));
		for (let y = y0; y < y1; y++) {
			mask.fill(value, y * width + x0, y * width + x1);
		}
	}
}

interface MaskedDiffStats {
	maskPx: number;
	changedPct: number;
	meanAbsDiff: number;
}

function maskedDiff(
	a: PNG,
	b: PNG,
	mask: Uint8Array | null,
	channelDelta: number
): MaskedDiffStats {
	const totalPx = a.width * a.height;
	let considered = 0;
	let changed = 0;
	let sum = 0;
	for (let p = 0; p < totalPx; p++) {
		if (mask !== null && mask[p] === 0) continue;
		considered++;
		const i = p * 4;
		const dr = Math.abs(a.data[i] - b.data[i]);
		const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
		const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
		sum += dr + dg + db;
		if (dr > channelDelta || dg > channelDelta || db > channelDelta) {
			changed++;
		}
	}
	return {
		maskPx: considered,
		changedPct: considered === 0 ? 0 : Number(((changed / considered) * 100).toFixed(2)),
		meanAbsDiff: considered === 0 ? 0 : Number((sum / (considered * 3) / 255).toFixed(5))
	};
}

function pairId(packX: string, packY: string): string {
	return [packX, packY].sort().join('~');
}

const packPairs: Array<[string, string]> = [];
for (let i = 0; i < catalogPacks.length; i++) {
	for (let j = i + 1; j < catalogPacks.length; j++) {
		packPairs.push([catalogPacks[i], catalogPacks[j]]);
	}
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

mkdirSync(cli.outDir, { recursive: true });

const target = await getTarget(cli.port);
const session = await CdpSession.connect(target.webSocketDebuggerUrl);
await session.send('Page.enable');
await session.send('Runtime.enable');
// The default resource-timing buffer (250 entries) overflows on a Vite dev
// page long before engine-state.svelte.ts is recorded — and the versioned-URL
// lookup in beginPackSwap NEEDS that entry (a bare-path dynamic import can
// resolve to a duplicate module instance whose writes the app never sees).
// Raise the buffer before every navigation.
await session.send('Page.addScriptToEvaluateOnNewDocument', {
	source: 'performance.setResourceTimingBufferSize(10000);'
});

async function runJob(job: CaptureJob): Promise<PresetReportEntry> {
	const scan = scanBySlug.get(job.slug);
	if (!scan) {
		throw new Error(`Preset "${job.slug}" disappeared between scan and run`);
	}
	const url = `${BASE_URL}/p/${job.slug}`;
	await session.send('Page.navigate', { url });
	await sleep(1800);
	await waitReady(session, job.slug);
	await sleep(900);

	const rect = await session.evaluate<CanvasRect>(
		// The COMPOSITION canvas is the largest-backing one — the editor chrome
		// renders small canvases too (timeline sound-clip waveforms), so a bare
		// querySelector('canvas') is order-dependent and unsafe.
		`(() => {
			const c = [...document.querySelectorAll('canvas')].sort(
				(a, b) => b.width * b.height - a.width * a.height
			)[0];
			const r = c.getBoundingClientRect();
			return { x: r.x, y: r.y, w: r.width, h: r.height, bw: c.width, bh: c.height };
		})()`
	);

	const timelineTime = await pinFrame(session, job.progress);
	await sleep(350);

	await beginPackSwap(session);
	const captures: Record<string, string> = {};
	const varsByPack: Record<string, string> = {};
	const regionsByPack: Record<string, RegionMeasurement> = {};
	try {
		for (const pack of catalogPacks) {
			await setPack(session, pack);
			varsByPack[pack] = await sampleAppearanceVars(session);
			regionsByPack[pack] = await measureRegions(session);
			const file = resolve(cli.outDir, `${job.slug}--${pack}.png`);
			await captureCanvas(session, rect, cli.captureScale, file);
			captures[pack] = file;
		}
		const fingerprints = Object.values(varsByPack);
		if (fingerprints[0].length > 0 && fingerprints.every((v) => v === fingerprints[0])) {
			// Harness artifact, not a pipeline verdict — thrown so the job-level
			// retry re-navigates and swaps on a fresh page.
			throw new Error(
				'pack swap did not restyle the DOM (appearance vars identical across all packs)'
			);
		}
	} finally {
		await endPackSwap(session);
	}

	// ---- Node-side masked diffs over every pack pair -----------------------
	const pngByPack: Record<string, PNG> = {};
	for (const pack of catalogPacks) {
		pngByPack[pack] = PNG.sync.read(readFileSync(captures[pack]));
	}
	const [firstPack, ...restPacks] = catalogPacks;
	const { width, height } = pngByPack[firstPack];
	for (const pack of restPacks) {
		const png = pngByPack[pack];
		if (png.width !== width || png.height !== height) {
			throw new Error(
				`Capture size mismatch for ${job.slug}: ${firstPack} ${width}x${height} vs ${pack} ${png.width}x${png.height}`
			);
		}
	}
	const inflatePxFor = (key: string): number =>
		Math.round(inflateFracFor(key) * Math.min(width, height));

	const frameDiff: Record<string, { changedPct: number }> = {};
	for (const [packX, packY] of packPairs) {
		const stats = maskedDiff(pngByPack[packX], pngByPack[packY], null, cli.channelDelta);
		frameDiff[pairId(packX, packY)] = { changedPct: stats.changedPct };
	}

	const pipelines: Record<string, PipelineRegionReport> = {};
	for (const pipelineKey of job.pipelines) {
		const hiddenUnderPacks = catalogPacks.filter(
			(pack) => regionsByPack[pack].hidden[pipelineKey] === true
		);
		const pairs: Record<string, PairRegionStats> = {};
		let maskPxUnion = 0;
		for (const [packX, packY] of packPairs) {
			const rects = [
				...(regionsByPack[packX].regions[pipelineKey] ?? []),
				...(regionsByPack[packY].regions[pipelineKey] ?? [])
			];
			if (rects.length === 0) {
				pairs[pairId(packX, packY)] = { changedPct: 0, meanAbsDiff: 0, maskPx: 0 };
				continue;
			}
			const mask = new Uint8Array(width * height);
			paintRects(mask, rects, width, height, inflatePxFor(pipelineKey), 1);
			// Immune stability masks subtract non-immune content layered ABOVE
			// the immune artifact — that content re-skins legitimately.
			if (immuneKeys.has(pipelineKey)) {
				for (const occluderKey of job.pipelines) {
					if (occluderKey === pipelineKey || immuneKeys.has(occluderKey)) continue;
					if (layerOfPipelineKey(occluderKey) <= layerOfPipelineKey(pipelineKey)) continue;
					const occluderRects = [
						...(regionsByPack[packX].regions[occluderKey] ?? []),
						...(regionsByPack[packY].regions[occluderKey] ?? [])
					];
					paintRects(mask, occluderRects, width, height, inflatePxFor(occluderKey), 0);
				}
			}
			const stats = maskedDiff(pngByPack[packX], pngByPack[packY], mask, cli.channelDelta);
			maskPxUnion = Math.max(maskPxUnion, stats.maskPx);
			const entry: PairRegionStats = {
				changedPct: stats.changedPct,
				meanAbsDiff: stats.meanAbsDiff,
				maskPx: stats.maskPx
			};
			// Frame-level pack treatments legitimately restyle immune artifacts —
			// exempt those pairs from the immunity stability check (they still
			// count for must-diff): chrome re-dresses the whole opaque frame
			// (appendPackChrome runs only when backgroundFill is declared), and a
			// material-treatment recipe rasters the merged frame in every render
			// path unless the Surface opts out via disablePackMaterial.
			if (immuneKeys.has(pipelineKey)) {
				const pairTouches = (packSet: ReadonlySet<string>): boolean =>
					packSet.has(packX) || packSet.has(packY);
				if (scan.hasBackgroundFill && pairTouches(chromePacks)) {
					entry.exempt = 'chrome';
				} else if (
					pairTouches(materialPacks) &&
					(scan.surfaceType === null || !surfaceDisablesPackMaterial(scan.surfaceType))
				) {
					entry.exempt = 'material';
				}
			}
			pairs[pairId(packX, packY)] = entry;
		}
		pipelines[pipelineKey] = {
			maskPctOfFrame: Number(((maskPxUnion / (width * height)) * 100).toFixed(2)),
			hiddenUnderPacks,
			pairs
		};
	}

	return {
		slug: job.slug,
		progress: job.progress,
		timelineTime: Number(timelineTime.toFixed(3)),
		packs: [...catalogPacks],
		presetSha256: presetFileHash(job.slug) ?? '',
		captures: Object.fromEntries(
			Object.entries(captures).map(([pack, path]) => [pack, path.replace(`${repoRoot}/`, '')])
		),
		frame: { width, height },
		frameDiff,
		pipelines,
		error: null
	};
}

const presetEntries = new Map<string, PresetReportEntry>();

for (const job of jobs) {
	process.stderr.write(`▶ ${job.slug} @ p=${job.progress} × ${catalogPacks.length} packs … `);
	// Two attempts: a concurrent dev session's HMR invalidation can full-reload
	// the page mid-job, which surfaces as a torn evaluate/swap — retry once on
	// a fresh navigation before recording a failure.
	let entry: PresetReportEntry | null = null;
	for (let attempt = 0; attempt < 2 && entry === null; attempt++) {
		try {
			entry = await runJob(job);
		} catch (jobError) {
			const message = jobError instanceof Error ? jobError.message : String(jobError);
			if (attempt === 0) {
				process.stderr.write(`retrying (${message}) … `);
				continue;
			}
			entry = {
				slug: job.slug,
				progress: job.progress,
				timelineTime: -1,
				packs: [...catalogPacks],
				presetSha256: presetFileHash(job.slug) ?? '',
				captures: {},
				frame: { width: 0, height: 0 },
				frameDiff: {},
				pipelines: {},
				error: message
			};
		}
	}
	if (entry === null) {
		continue;
	}
	presetEntries.set(entry.slug, entry);
	if (entry.error !== null) {
		process.stderr.write(`ERROR ${entry.error}\n`);
	} else {
		const worst = Math.min(
			...Object.values(entry.pipelines).flatMap((pipeline) =>
				Object.values(pipeline.pairs).map((pair) => pair.changedPct)
			),
			100
		);
		process.stderr.write(`region diffs ≥ ${worst}%\n`);
	}
}

session.close();

// ---------------------------------------------------------------------------
// Merge retained rows (--only) — refuse stale evidence instead of clobbering
// ---------------------------------------------------------------------------

const globalHashes = computeGlobalSourceHashes();
const staleRetained: string[] = [];

if (cli.only !== null) {
	const previous = loadExistingReport();
	if (previous !== null) {
		const globalsFresh =
			previous.sources.script === globalHashes.script &&
			previous.sources.pipelinesTree === globalHashes.pipelinesTree &&
			catalogPacks.every((pack) => previous.sources.packs[pack] === globalHashes.packs[pack]);
		for (const entry of previous.presets) {
			if (presetEntries.has(entry.slug)) {
				continue; // re-captured this run
			}
			const currentHash = presetFileHash(entry.slug);
			const retainedFresh =
				globalsFresh &&
				currentHash !== null &&
				currentHash === entry.presetSha256 &&
				[...entry.packs].sort().join(',') === catalogPacks.join(',');
			if (retainedFresh) {
				presetEntries.set(entry.slug, entry);
			} else {
				staleRetained.push(entry.slug);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Verdicts + report
// ---------------------------------------------------------------------------

let failures = 0;
let warnings = 0;

function pairLabel(id: string): string {
	return id.replace('~', '↔');
}

const rows: CoverageRow[] = coverage.map((entry) => {
	const immune = entry.status === 'immune-covered' || entry.status === 'immune-gap';
	if (entry.status === 'gap') {
		failures++;
		return {
			pipeline: entry.pipeline,
			preset: '—',
			status: 'FAIL-GAP',
			maskPctOfFrame: '—',
			worstPair: '—',
			detail: 'no covering preset — a registered non-immune pipeline is UNLOCKED'
		};
	}
	if (entry.status === 'immune-gap') {
		warnings++;
		return {
			pipeline: entry.pipeline,
			preset: '—',
			status: 'IMMUNE-GAP',
			maskPctOfFrame: '—',
			worstPair: '—',
			detail: 'immune, no covering preset — inverse stability check unproven'
		};
	}
	const presetSlug = entry.preset as string;
	const result = presetEntries.get(presetSlug);
	if (!result) {
		if (staleRetained.includes(presetSlug)) {
			failures++;
			return {
				pipeline: entry.pipeline,
				preset: presetSlug,
				status: 'STALE',
				maskPctOfFrame: '—',
				worstPair: '—',
				detail: 'retained evidence is stale (sources changed) — re-run without --only'
			};
		}
		failures++;
		return {
			pipeline: entry.pipeline,
			preset: presetSlug,
			status: 'MISSING',
			maskPctOfFrame: '—',
			worstPair: '—',
			detail: `no evidence captured — include "${presetSlug}" in --only or run the full probe`
		};
	}
	if (result.error !== null) {
		failures++;
		return {
			pipeline: entry.pipeline,
			preset: presetSlug,
			status: 'ERROR',
			maskPctOfFrame: '—',
			worstPair: '—',
			detail: result.error
		};
	}
	const pipeline = result.pipelines[entry.pipeline];
	if (!pipeline) {
		failures++;
		return {
			pipeline: entry.pipeline,
			preset: presetSlug,
			status: 'ERROR',
			maskPctOfFrame: '—',
			worstPair: '—',
			detail:
				'no region stats recorded for this pipeline (retained entry from a different coverage map?)'
		};
	}
	const measuredPairs = Object.entries(pipeline.pairs);
	const emptyPairs = measuredPairs.filter(([, stats]) => stats.maskPx === 0);
	if (emptyPairs.length > 0) {
		failures++;
		return {
			pipeline: entry.pipeline,
			preset: presetSlug,
			status: 'ERROR',
			maskPctOfFrame: '—',
			worstPair: pairLabel(emptyPairs[0][0]),
			detail: `no measurable region at p=${entry.progress} — pick a PRESET_PROGRESS where the pipeline is on-frame`
		};
	}

	if (!immune) {
		const sorted = [...measuredPairs].sort((a, b) => a[1].changedPct - b[1].changedPct);
		const [worstId, worstStats] = sorted[0];
		const pass = worstStats.changedPct >= cli.regionChangedPctMin;
		if (!pass) failures++;
		const hiddenNote =
			pipeline.hiddenUnderPacks.length > 0
				? ` (mount opacity≈0 under: ${pipeline.hiddenUnderPacks.join(', ')} — frame choice?)`
				: '';
		return {
			pipeline: entry.pipeline,
			preset: presetSlug,
			status: pass ? 'PASS' : 'FAIL',
			maskPctOfFrame: `${pipeline.maskPctOfFrame}%`,
			worstPair: `${pairLabel(worstId)} ${worstStats.changedPct}%`,
			detail: pass
				? `region re-skins under every pack pair (min ${worstStats.changedPct}%)`
				: `region diff ${worstStats.changedPct}% < ${cli.regionChangedPctMin}% under ${pairLabel(worstId)} — partial pack buy-in?${hiddenNote}`
		};
	}

	const checkedPairs = measuredPairs.filter(([, stats]) => stats.exempt === undefined);
	if (checkedPairs.length === 0) {
		warnings++;
		return {
			pipeline: entry.pipeline,
			preset: presetSlug,
			status: 'IMMUNE-GAP',
			maskPctOfFrame: `${pipeline.maskPctOfFrame}%`,
			worstPair: '—',
			detail:
				'every pack pair is exempt (chrome/material treatments) on this preset — stability unproven'
		};
	}
	const sorted = [...checkedPairs].sort((a, b) => b[1].changedPct - a[1].changedPct);
	const [worstId, worstStats] = sorted[0];
	const stable = worstStats.changedPct <= cli.immunityMaxPct;
	if (!stable) failures++;
	return {
		pipeline: entry.pipeline,
		preset: presetSlug,
		status: stable ? 'IMMUNE-PASS' : 'IMMUNE-FAIL',
		maskPctOfFrame: `${pipeline.maskPctOfFrame}%`,
		worstPair: `${pairLabel(worstId)} ${worstStats.changedPct}%`,
		detail: stable
			? `artifact stays put under pack swaps (max ${worstStats.changedPct}%)`
			: `region diff ${worstStats.changedPct}% > ${cli.immunityMaxPct}% under ${pairLabel(worstId)} — declared immunity is not real (or an occluder is unsubtracted)`
	};
});

const widths = {
	pipeline: Math.max(...rows.map((r) => r.pipeline.length), 'pipeline'.length),
	preset: Math.max(...rows.map((r) => r.preset.length), 'preset'.length),
	mask: Math.max(...rows.map((r) => r.maskPctOfFrame.length), 'mask'.length),
	worst: Math.max(...rows.map((r) => r.worstPair.length), 'worst pair'.length),
	status: Math.max(...rows.map((r) => r.status.length), 'status'.length)
};

console.log('');
console.log(
	`${'pipeline'.padEnd(widths.pipeline)}  ${'preset'.padEnd(widths.preset)}  ${'mask'.padEnd(widths.mask)}  ${'worst pair'.padEnd(widths.worst)}  ${'status'.padEnd(widths.status)}  detail`
);
for (const row of rows) {
	console.log(
		`${row.pipeline.padEnd(widths.pipeline)}  ${row.preset.padEnd(widths.preset)}  ${row.maskPctOfFrame.padEnd(widths.mask)}  ${row.worstPair.padEnd(widths.worst)}  ${row.status.padEnd(widths.status)}  ${row.detail}`
	);
}

const coveredPresetSlugs = [...presetEntries.keys()].sort();
const report: PackDiffReport = {
	generatedAt: new Date().toISOString(),
	evidence: { ...EVIDENCE_BLOCK },
	packs: [...catalogPacks],
	thresholds: {
		regionChangedPctMin: cli.regionChangedPctMin,
		immunityMaxPct: cli.immunityMaxPct,
		perChannelDelta: cli.channelDelta,
		captureScale: cli.captureScale,
		regionInflateFrac: REGION_INFLATE_FRAC,
		annotationInflateFrac: ANNOTATION_INFLATE_FRAC
	},
	sources: {
		...globalHashes,
		presets: Object.fromEntries(
			coveredPresetSlugs.map((slug) => [slug, presetEntries.get(slug)?.presetSha256 ?? ''])
		)
	},
	coverage: rows,
	presets: coveredPresetSlugs.map((slug) => presetEntries.get(slug) as PresetReportEntry)
};
writeFileSync(summaryPath, `${JSON.stringify(report, null, '\t')}\n`);

console.log('');
if (warnings > 0) {
	console.log(`⚠ ${warnings} warning(s) — see IMMUNE-GAP rows above.`);
}
console.log(`Stats + per-pack captures: ${cli.outDir}`);
if (failures > 0) {
	console.error(
		`✗ ${failures} pipeline row(s) FAILED the attributable catalog pack-diff (must-diff, immunity, coverage, or freshness).`
	);
	process.exit(1);
}
console.log(
	`✓ Every registered pipeline holds its Pack contract across ${catalogPacks.length} catalog packs (${packPairs.length} pairs, region-attributed).`
);
process.exit(0);
