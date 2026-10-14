// The library's posters, rendered by the real app one composition at a time
// (ADR-0061). Each card on the home page shows the still this script wrote for
// it, on every origin — the local build and the hosted one that keeps nothing —
// so the run is what decides how the library looks.
//
// One invocation, no interactive tooling. The run starts its own jailed dev
// server, confirms the sanctioned CanvasDrawElement Chrome through
// scripts/launch-cdp-chrome.sh, opens each Preset in the Workspace over CDP,
// and photographs it at a few candidate frames through the Workspace's own
// poster seam (`window.__gfxCapturePosterFrameAt`). The frame that shows the
// most is kept; a Preset that shows nothing at every candidate gets no poster
// and fails the run rather than a blank card.
//
//   pnpm capture:posters              every Preset whose poster is missing or stale
//   pnpm capture:posters <slug…>      these Presets, current or not
//   pnpm capture:posters --all        every Preset, current or not
//
// Writes src/lib/assets/composition-posters/<slug>.webp and manifest.json, and
// refreshes each Surface's default in static/surface-posters/ from its
// representative Preset. `composition-posters.test.ts` fails while a
// deliverable's poster is missing or stale, so this is the run that makes a
// changed Preset landable again.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Preset } from '../src/lib/platform/engine-schema.ts';
import type { ScriptedPosterFrameCapture } from '../src/lib/platform/posters.ts';
import {
	choosePosterFrame,
	posterCandidateTimestamps
} from '../src/lib/utils/poster-frame-choice.ts';
import { registerGfxRuntimeModuleHooks } from './gfx-runtime-module-hooks.ts';
import {
	assertVerificationOriginAllowed,
	createVerificationServerJail,
	type VerificationServerJail
} from './verification-server-jail.ts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

registerGfxRuntimeModuleHooks(repositoryRoot);

const presetsDirectory = resolve(repositoryRoot, 'src/lib/presets');
const postersDirectory = resolve(repositoryRoot, 'src/lib/assets/composition-posters');
const manifestPath = join(postersDirectory, 'manifest.json');
const surfacePostersDirectory = resolve(repositoryRoot, 'static/surface-posters');

/**
 * The Preset each Surface's default poster is taken from — the still a User
 * composition's card shows before its own capture exists. Picked to read
 * clearly as that Surface.
 */
const SURFACE_POSTER_REPRESENTATIVES: Readonly<Record<string, string>> = {
	'brand-mark': 'title-card-brand-mark',
	'chapter-card': 'chapter-card-descent',
	checklist: 'checklist-show-rundown',
	imessage: 'imessage-friday-deploy',
	newspaper: 'title-card-newspaper',
	paper: 'research-paper-attention',
	plain: 'counter-milestone',
	'pullquote-on-photo': 'pullquote-on-photo',
	'title-sequence': 'title-sequence-drop',
	'type-hero': 'type-hero-vantage',
	'web-document': 'web-document-wikipedia',
	'website-screenshot': 'website-showcase'
};

/** Ports of this run's own, so the capture never addresses the dev server's real store. */
const POSTER_CAPTURE_SERVER_PORT = Number(process.env.GFX_POSTER_CAPTURE_PORT ?? 7295);
const POSTER_CAPTURE_CDP_PORT = Number(process.env.GFX_POSTER_CAPTURE_CDP_PORT ?? 9253);
const posterCaptureOrigin = `http://localhost:${POSTER_CAPTURE_SERVER_PORT}`;

/** The app's own layout at a laptop size; the poster reads the canvas, not the viewport. */
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 } as const;

const SERVER_READY_TIMEOUT_MS = 120_000;
const WORKSPACE_READY_TIMEOUT_MS = 120_000;
/** How long one candidate frame may take to settle and read back before the Preset counts as failed. */
const CANDIDATE_CAPTURE_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

/**
 * The COMPOSITION canvas is the largest-backing one. The editor chrome renders
 * small canvases too (timeline sound-clip waveforms), so document order is not
 * a stable way to find it.
 */
const COMPOSITION_CANVAS = `[...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]`;

const sleep = (milliseconds: number): Promise<void> =>
	new Promise((settle) => setTimeout(settle, milliseconds));

// ---------------------------------------------------------------------------
// The catalog, read the way the app reads it (schema + semantic validation),
// so the content key computed here is the one the home page compares against.

interface CataloguedPosterSubject {
	slug: string;
	name: string;
	kind: Preset['kind'];
	surfaceType: string;
	durationSeconds: number;
	posterSeconds: number | undefined;
	contentKey: string;
}

interface PresetIngressModule {
	PresetIngressSchema: { safeParse(value: unknown): { success: boolean; data?: Preset } };
}
interface PresetValidationModule {
	validatePresetSemantics(
		preset: Preset,
		options?: { resolvePreset(slug: string): Preset | null }
	): readonly unknown[];
}
interface PostersModule {
	posterKeyForPreset(preset: Preset): string;
}

async function readCatalog(): Promise<CataloguedPosterSubject[]> {
	const { PresetIngressSchema } = (await import(
		pathToFileURL(resolve(repositoryRoot, 'src/lib/platform/preset-ingress.ts')).href
	)) as PresetIngressModule;
	const { validatePresetSemantics } = (await import(
		pathToFileURL(resolve(repositoryRoot, 'src/lib/platform/preset-validation.ts')).href
	)) as PresetValidationModule;
	const { posterKeyForPreset } = (await import(
		pathToFileURL(resolve(repositoryRoot, 'src/lib/platform/posters.ts')).href
	)) as PostersModule;

	const schemaValid = new Map<string, Preset>();
	for (const fileName of (await readdir(presetsDirectory)).sort()) {
		if (!fileName.endsWith('.json')) continue;
		const slug = fileName.slice(0, -'.json'.length);
		const raw = JSON.parse(await readFile(join(presetsDirectory, fileName), 'utf8')) as unknown;
		const parsed = PresetIngressSchema.safeParse(raw);
		if (!parsed.success || !parsed.data) continue;
		if (validatePresetSemantics(parsed.data).length > 0) continue;
		schemaValid.set(slug, parsed.data);
	}
	const subjects: CataloguedPosterSubject[] = [];
	for (const [slug, preset] of schemaValid) {
		const issues = validatePresetSemantics(preset, {
			resolvePreset: (reference) => schemaValid.get(reference) ?? null
		});
		if (issues.length > 0) continue;
		subjects.push({
			slug,
			name: preset.name,
			kind: preset.kind,
			surfaceType: preset.state.surface.type,
			durationSeconds: preset.state.transport.durationSeconds,
			posterSeconds: preset.state.transport.posterSeconds,
			contentKey: posterKeyForPreset(preset)
		});
	}
	return subjects;
}

// ---------------------------------------------------------------------------
// The manifest: what `composition-posters.ts` reads at build time.

interface CommittedPosterRow {
	contentKey: string;
	timestampSeconds: number;
	width: number;
	height: number;
	contentFraction: number;
}

async function readManifest(): Promise<Record<string, CommittedPosterRow>> {
	try {
		return JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, CommittedPosterRow>;
	} catch {
		return {};
	}
}

async function writeManifest(manifest: Record<string, CommittedPosterRow>): Promise<void> {
	const sorted = Object.fromEntries(
		Object.entries(manifest).sort(([left], [right]) => left.localeCompare(right))
	);
	await writeFile(manifestPath, `${JSON.stringify(sorted, null, '\t')}\n`);
}

const posterPathForSlug = (slug: string): string => join(postersDirectory, `${slug}.webp`);

async function fileExists(path: string): Promise<boolean> {
	try {
		await readFile(path);
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// The app under the camera and the browser that films it.

interface PosterDevServer {
	stop(): Promise<void>;
}

/**
 * The app runs from the jail's store and scratch directories on a port of its
 * own: a capture must never be able to reach the author's real compositions,
 * and `assertVerificationOriginAllowed` refuses the dev server's port outright.
 */
async function startPosterDevServer(jail: VerificationServerJail): Promise<PosterDevServer> {
	assertVerificationOriginAllowed(posterCaptureOrigin);
	const child = spawn(
		'pnpm',
		['exec', 'vp', 'dev', '--port', String(POSTER_CAPTURE_SERVER_PORT), '--strictPort'],
		{
			cwd: repositoryRoot,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, ...jail.environment }
		}
	);
	const stop = async (): Promise<void> => {
		if (child.exitCode === null) child.kill('SIGTERM');
		await sleep(250);
		if (child.exitCode === null) child.kill('SIGKILL');
	};

	const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`The poster dev server exited with ${child.exitCode}.`);
		}
		try {
			const response = await fetch(posterCaptureOrigin);
			if (response.ok) return { stop };
		} catch {
			// Not listening yet.
		}
		await sleep(POLL_INTERVAL_MS);
	}
	await stop();
	throw new Error(`The poster dev server never answered at ${posterCaptureOrigin}.`);
}

interface CdpPage {
	send<T>(method: string, params?: Record<string, unknown>): Promise<T>;
	evaluate<T>(expression: string): Promise<T>;
	close(): Promise<void>;
}

async function openCdpPage(): Promise<CdpPage> {
	const response = await fetch(
		`http://localhost:${POSTER_CAPTURE_CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`,
		{ method: 'PUT' }
	);
	if (!response.ok) throw new Error(`CDP ${POSTER_CAPTURE_CDP_PORT} would not open a target.`);
	const target = (await response.json()) as { webSocketDebuggerUrl: string };
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise<void>((settle, fail) => {
		socket.onopen = () => settle();
		socket.onerror = () => fail(new Error('The CDP socket refused the connection.'));
	});

	let nextId = 1;
	const pending = new Map<
		number,
		{ settle: (value: unknown) => void; fail: (error: Error) => void }
	>();
	socket.onmessage = (event: MessageEvent) => {
		const message = JSON.parse(String(event.data)) as {
			id?: number;
			error?: { message: string };
			result?: unknown;
		};
		if (message.id === undefined) return;
		const waiting = pending.get(message.id);
		if (!waiting) return;
		pending.delete(message.id);
		if (message.error) waiting.fail(new Error(message.error.message));
		else waiting.settle(message.result ?? {});
	};

	const send = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
		new Promise<T>((settle, fail) => {
			const id = nextId++;
			pending.set(id, { settle: (value) => settle(value as T), fail });
			socket.send(JSON.stringify({ id, method, params }));
		});

	async function evaluate<T>(expression: string): Promise<T> {
		const result = await send<{
			exceptionDetails?: { text: string; exception?: { description?: string } };
			result: { value: T };
		}>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (result.exceptionDetails) {
			throw new Error(
				result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
			);
		}
		return result.result.value;
	}

	await Promise.all([send('Page.enable'), send('Runtime.enable')]);
	await send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, mobile: false });

	return {
		send,
		evaluate,
		close: async () => {
			await send('Page.close').catch(() => undefined);
			socket.close();
		}
	};
}

/**
 * Shut the run's browser down before the jail is removed. Chrome keeps writing
 * to its profile directory, and this profile lives inside the jail — a dispose
 * that races a live browser fails on a directory Chrome just refilled.
 */
async function closeHarnessBrowser(): Promise<void> {
	const version = (await fetch(`http://localhost:${POSTER_CAPTURE_CDP_PORT}/json/version`).then(
		(response) => response.json()
	)) as { webSocketDebuggerUrl?: string };
	if (!version.webSocketDebuggerUrl) return;
	const socket = new WebSocket(version.webSocketDebuggerUrl);
	await new Promise<void>((settle, fail) => {
		socket.onopen = () => settle();
		socket.onerror = () => fail(new Error('The CDP browser endpoint refused the connection.'));
	});
	socket.send(JSON.stringify({ id: 1, method: 'Browser.close', params: {} }));
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await sleep(POLL_INTERVAL_MS);
		try {
			await fetch(`http://localhost:${POSTER_CAPTURE_CDP_PORT}/json/version`);
		} catch {
			socket.close();
			return;
		}
	}
	socket.close();
}

/** What the page must be showing before a frame is photographed. */
interface WorkspaceReadiness {
	canvas: boolean;
	posterSeam: boolean;
	complete: boolean;
	pathname: string;
	canvasDrawElement: boolean;
}

/**
 * Wait for the real thing: the composition canvas mounted, the poster seam
 * exposed, the route settled, and the open Preset's own name on the page.
 * Photographing a page that has not applied its Preset yet produces a picture
 * of whatever the tab was showing before.
 */
async function awaitWorkspace(page: CdpPage, subject: CataloguedPosterSubject): Promise<void> {
	const pageUrl = `${posterCaptureOrigin}/p/${subject.slug}`;
	const expectedPathname = new URL(pageUrl).pathname;
	await page.send('Page.navigate', { url: pageUrl });

	const deadline = Date.now() + WORKSPACE_READY_TIMEOUT_MS;
	let latest: WorkspaceReadiness | null = null;
	while (Date.now() < deadline) {
		try {
			latest = await page.evaluate<WorkspaceReadiness>(`(() => ({
				canvas: !!(${COMPOSITION_CANVAS}),
				posterSeam: typeof window.__gfxCapturePosterFrameAt === 'function',
				complete: document.readyState === 'complete',
				pathname: location.pathname,
				canvasDrawElement: typeof GPUQueue !== 'undefined' && 'copyElementImageToTexture' in GPUQueue.prototype
			}))()`);
			if (!latest.canvasDrawElement) {
				throw new Error(
					`CanvasDrawElement is unavailable on CDP port ${POSTER_CAPTURE_CDP_PORT}; the app hard-gates without it.`
				);
			}
			if (
				latest.canvas &&
				latest.posterSeam &&
				latest.complete &&
				latest.pathname === expectedPathname
			) {
				break;
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes('CanvasDrawElement')) throw error;
			// The page is still navigating; Runtime.evaluate has no context to run in.
		}
		await sleep(POLL_INTERVAL_MS);
	}
	if (!latest?.canvas || !latest.posterSeam) {
		throw new Error(
			`The Workspace never mounted at ${pageUrl}; last saw ${JSON.stringify(latest)}.`
		);
	}

	const appliedDeadline = Date.now() + 30_000;
	while (Date.now() < appliedDeadline) {
		try {
			const applied = await page.evaluate<boolean>(
				`document.body.textContent?.includes(${JSON.stringify(subject.name)}) === true`
			);
			if (applied) return;
		} catch {
			// The dev server can reload the page once more after first paint (a
			// newly discovered dependency gets optimised); keep polling the new document.
		}
		await sleep(POLL_INTERVAL_MS);
	}
	throw new Error(
		`The Workspace never applied "${subject.name}"; it would have photographed another page.`
	);
}

/** One candidate frame through the Workspace's poster seam, bounded in time. */
async function capturePosterCandidate(
	page: CdpPage,
	timestampSeconds: number
): Promise<ScriptedPosterFrameCapture | null> {
	return page.evaluate<ScriptedPosterFrameCapture | null>(`(() => {
		const capture = window.__gfxCapturePosterFrameAt(${timestampSeconds});
		const timeout = new Promise((_, fail) =>
			setTimeout(
				() => fail(new Error('The frame at ${timestampSeconds}s never settled within ${CANDIDATE_CAPTURE_TIMEOUT_MS}ms.')),
				${CANDIDATE_CAPTURE_TIMEOUT_MS}
			)
		);
		return Promise.race([capture, timeout]);
	})()`);
}

/** Photograph one Preset at its candidate frames and keep the one that shows the most. */
async function capturePoster(
	page: CdpPage,
	subject: CataloguedPosterSubject
): Promise<CommittedPosterRow> {
	await awaitWorkspace(page, subject);
	const candidates: ScriptedPosterFrameCapture[] = [];
	for (const timestampSeconds of posterCandidateTimestamps(
		subject.durationSeconds,
		subject.posterSeconds
	)) {
		const candidate = await capturePosterCandidate(page, timestampSeconds);
		if (!candidate) throw new Error(`The canvas of "${subject.slug}" had nothing to read.`);
		candidates.push(candidate);
	}
	const chosen = choosePosterFrame(candidates);
	if (!chosen) {
		const seen = candidates
			.map(
				(candidate) =>
					`${candidate.timestampSeconds.toFixed(2)}s=${(candidate.contentFraction * 100).toFixed(2)}%`
			)
			.join(', ');
		throw new Error(
			`No candidate frame of "${subject.slug}" shows anything (${seen}); a blank card is not a poster.`
		);
	}
	const still = candidates.find((candidate) => candidate === chosen);
	if (!still)
		throw new Error(`The chosen frame of "${subject.slug}" was not among its candidates.`);
	await mkdir(postersDirectory, { recursive: true });
	await writeFile(posterPathForSlug(subject.slug), Buffer.from(still.webpBase64, 'base64'));
	return {
		contentKey: subject.contentKey,
		timestampSeconds: Number(still.timestampSeconds.toFixed(3)),
		width: still.width,
		height: still.height,
		contentFraction: Number(still.contentFraction.toFixed(4))
	};
}

// ---------------------------------------------------------------------------

const requestedSlugs = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const captureEverything = process.argv.includes('--all');

const catalog = await readCatalog();
const catalogBySlug = new Map(catalog.map((subject) => [subject.slug, subject]));
const manifest = await readManifest();

const unknownSlugs = requestedSlugs.filter((slug) => !catalogBySlug.has(slug));
if (unknownSlugs.length > 0) {
	throw new Error(
		`Not in the catalog (or not a valid Preset): ${unknownSlugs.join(', ')}. Run pnpm verify-presets first.`
	);
}

// Posters for Presets the catalog no longer lists are removed with their rows,
// so the manifest never claims a composition that cannot be opened.
for (const slug of Object.keys(manifest)) {
	if (catalogBySlug.has(slug)) continue;
	delete manifest[slug];
	await rm(posterPathForSlug(slug), { force: true });
	console.log(`removed ${slug} (no longer in the catalog)`);
}

async function isPosterCurrent(subject: CataloguedPosterSubject): Promise<boolean> {
	const row = manifest[subject.slug];
	return (
		row !== undefined &&
		row.contentKey === subject.contentKey &&
		(await fileExists(posterPathForSlug(subject.slug)))
	);
}

const subjects: CataloguedPosterSubject[] = [];
for (const subject of catalog) {
	if (requestedSlugs.length > 0) {
		if (requestedSlugs.includes(subject.slug)) subjects.push(subject);
		continue;
	}
	if (captureEverything || !(await isPosterCurrent(subject))) subjects.push(subject);
}

const failures: { slug: string; kind: Preset['kind']; message: string }[] = [];

if (subjects.length === 0) {
	console.log('Every committed poster is current; nothing to photograph.');
} else {
	console.log(`Photographing ${subjects.length} of ${catalog.length} compositions…`);
	const jail = await createVerificationServerJail('composition-posters');
	const server = await startPosterDevServer(jail);
	const harness = spawnSync('scripts/launch-cdp-chrome.sh', [], {
		cwd: repositoryRoot,
		stdio: 'inherit',
		env: {
			...process.env,
			CDP_PORT: String(POSTER_CAPTURE_CDP_PORT),
			CDP_BROWSER_MODE: 'canvas',
			CDP_PROFILE_DIR: jail.chromeProfileDirectory
		}
	});
	if (harness.status !== 0) {
		await server.stop();
		await jail.dispose();
		throw new Error(`The sanctioned CDP harness would not start (status ${harness.status}).`);
	}

	let page: CdpPage | null = null;
	try {
		page = await openCdpPage();
		for (const subject of subjects) {
			const startedAt = Date.now();
			// One retry from a fresh navigation: the dev server's dependency
			// optimiser can reload a page mid-capture the first time a Preset's
			// renderers are loaded, and a second pass sees them already optimised.
			let lastError: unknown = null;
			for (let attempt = 0; attempt < 2; attempt += 1) {
				try {
					if (attempt > 0) {
						// A retry gets a fresh tab: a target the first attempt lost (a
						// renderer crash, a closed page) would otherwise fail every step.
						await page.close().catch(() => undefined);
						page = await openCdpPage();
					}
					const row = await capturePoster(page, subject);
					manifest[subject.slug] = row;
					await writeManifest(manifest);
					console.log(
						`ok   ${subject.slug}  ${row.width}×${row.height} at ${row.timestampSeconds}s ` +
							`(${(row.contentFraction * 100).toFixed(1)}% content, ${((Date.now() - startedAt) / 1000).toFixed(1)}s` +
							`${attempt > 0 ? ', on retry' : ''})`
					);
					lastError = null;
					break;
				} catch (error) {
					lastError = error;
				}
			}
			if (lastError !== null) {
				const message = lastError instanceof Error ? lastError.message : String(lastError);
				failures.push({ slug: subject.slug, kind: subject.kind, message });
				console.log(`FAIL ${subject.slug}  ${message}`);
			}
		}
	} finally {
		await page?.close().catch(() => undefined);
		await closeHarnessBrowser().catch(() => undefined);
		await server.stop();
		await jail.dispose();
	}
}

// Surface defaults follow their representatives: a byte-identical copy is a
// no-op in git, so this runs on every invocation.
await mkdir(surfacePostersDirectory, { recursive: true });
for (const [surfaceType, slug] of Object.entries(SURFACE_POSTER_REPRESENTATIVES)) {
	const subject = catalogBySlug.get(slug);
	if (!subject) {
		console.warn(
			`warn surface default ${surfaceType}: representative "${slug}" is not in the catalog`
		);
		continue;
	}
	if (subject.surfaceType !== surfaceType) {
		console.warn(
			`warn surface default ${surfaceType}: representative "${slug}" is a ${subject.surfaceType} Surface`
		);
		continue;
	}
	if (!(await isPosterCurrent(subject))) {
		console.warn(
			`warn surface default ${surfaceType}: representative "${slug}" has no current poster`
		);
		continue;
	}
	await writeFile(
		join(surfacePostersDirectory, `${surfaceType}.webp`),
		await readFile(posterPathForSlug(slug))
	);
}

await writeManifest(manifest);

const blockingFailures = failures.filter(
	(failure) => failure.kind !== 'fixture' || requestedSlugs.includes(failure.slug)
);
const fixtureWarnings = failures.filter((failure) => !blockingFailures.includes(failure));
if (fixtureWarnings.length > 0) {
	console.warn(
		`${fixtureWarnings.length} fixture(s) produced no poster and keep their Surface default: ` +
			fixtureWarnings.map((failure) => failure.slug).join(', ')
	);
}
if (blockingFailures.length > 0) {
	console.error(
		`${blockingFailures.length} composition(s) produced no poster: ` +
			blockingFailures.map((failure) => `${failure.slug} (${failure.message})`).join('; ')
	);
	process.exit(1);
}
console.log(
	`Posters: ${Object.keys(manifest).length} committed for ${catalog.length} catalogued compositions.`
);
