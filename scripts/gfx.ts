import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Page } from 'playwright';

import { readGfxEnvironmentValue } from '../src/lib/utils/legacy-supers-compatibility.ts';
import { connectCdpRenderBrowser } from './cdp-render-page.ts';

export interface RenderJob {
	preset: string;
	out: string;
}

export type PresetTransportFormat = 'webm' | 'prores';

export interface PreparedPreset {
	slug: string;
	format: PresetTransportFormat;
	cleanup: () => Promise<void>;
}

const APP_URL = readGfxEnvironmentValue(process.env, 'GFX_URL') ?? 'http://localhost:7263';
const CDP_URL =
	readGfxEnvironmentValue(process.env, 'GFX_CDP_URL') ??
	`http://localhost:${process.env.CDP_PORT ?? '9223'}`;
const RENDER_TIMEOUT_MS = Number(
	readGfxEnvironmentValue(process.env, 'GFX_RENDER_TIMEOUT_MS') ?? 10 * 60_000
);
const READY_TIMEOUT_MS = Number(
	readGfxEnvironmentValue(process.env, 'GFX_READY_TIMEOUT_MS') ?? 30_000
);

function usage(): never {
	throw new Error(
		'Usage: gfx render --preset <slug-or-path> --out <file> | gfx batch <manifest.json>'
	);
}

function readFlag(args: readonly string[], flag: string): string {
	const index = args.indexOf(flag);
	const value = index >= 0 ? args[index + 1] : undefined;
	if (!value || value.startsWith('--')) usage();
	return value;
}

export function isFilePreset(value: string): boolean {
	return value.endsWith('.json') || value.includes('/') || value.includes('\\');
}

/**
 * The output format a composition document declares. A stored User composition
 * is a `gfx-film@1` Film, which states `format` once for all its Scenes
 * (ADR-0068 §1); a corpus Preset or a Preset file states it in its transport.
 */
function presetTransportFormat(value: unknown, description: string): PresetTransportFormat {
	if (
		typeof value === 'object' &&
		value !== null &&
		'schema' in value &&
		value.schema === 'gfx-film@1'
	) {
		if (!('format' in value) || (value.format !== 'webm' && value.format !== 'prores')) {
			throw new TypeError(`${description} does not declare a Film format.`);
		}
		return value.format;
	}
	if (
		typeof value !== 'object' ||
		value === null ||
		!('state' in value) ||
		typeof value.state !== 'object' ||
		value.state === null ||
		!('transport' in value.state) ||
		typeof value.state.transport !== 'object' ||
		value.state.transport === null ||
		!('format' in value.state.transport) ||
		(value.state.transport.format !== 'webm' && value.state.transport.format !== 'prores')
	) {
		throw new TypeError(`${description} does not declare state.transport.format.`);
	}
	return value.state.transport.format;
}

export function assertOutputExtension(format: PresetTransportFormat, outputPath: string): void {
	const expectedExtension = format === 'prores' ? '.mov' : '.webm';
	const actualExtension = extname(outputPath).toLowerCase();
	if (actualExtension !== expectedExtension) {
		throw new TypeError(
			`Output extension ${actualExtension || '(none)'} does not match Preset transport.format "${format}"; expected ${expectedExtension}.`
		);
	}
}

async function responseFailure(response: Response): Promise<string> {
	const text = await response.text();
	if (!text) return `${response.status} ${response.statusText}`.trim();
	try {
		const value: unknown = JSON.parse(text);
		if (typeof value === 'object' && value !== null && 'message' in value) {
			const message = (value as { message?: unknown }).message;
			if (typeof message === 'string') return message;
		}
	} catch {
		return text;
	}
	return text;
}

async function assertRuntimeAvailable(): Promise<void> {
	const [appResponse, cdpResponse] = await Promise.all([
		fetch(APP_URL),
		fetch(`${CDP_URL}/json/version`)
	]);
	if (!appResponse.ok) {
		throw new Error(`GFX dev server is unavailable at ${APP_URL}.`);
	}
	if (!cdpResponse.ok) {
		throw new Error(`CanvasDrawElement browser is unavailable at ${CDP_URL}.`);
	}
}

async function readCorpusPreset(presetInput: string): Promise<unknown> {
	if (!/^[a-z0-9_-]+$/.test(presetInput)) {
		throw new TypeError(`Invalid Preset slug "${presetInput}".`);
	}
	try {
		return JSON.parse(
			await readFile(resolve('src/lib/presets', `${presetInput}.json`), 'utf-8')
		) as unknown;
	} catch (error) {
		throw new Error(`Preset "${presetInput}" was not found in the User store or corpus.`, {
			cause: error
		});
	}
}

export async function preparePreset(presetInput: string): Promise<PreparedPreset> {
	if (!isFilePreset(presetInput)) {
		const response = await fetch(
			`${APP_URL}/api/user-compositions/${encodeURIComponent(presetInput)}`
		);
		if (!response.ok) {
			throw new Error(`Preset lookup failed: ${await responseFailure(response)}`);
		}
		const storedPreset: unknown = await response.json();
		const preset = storedPreset === null ? await readCorpusPreset(presetInput) : storedPreset;
		return {
			slug: presetInput,
			format: presetTransportFormat(preset, `Preset "${presetInput}"`),
			cleanup: async () => undefined
		};
	}

	const presetPath = resolve(presetInput);
	let preset: unknown;
	try {
		preset = JSON.parse(await readFile(presetPath, 'utf-8')) as unknown;
	} catch (error) {
		throw new Error(`Failed to read Preset ${presetPath}.`, { cause: error });
	}
	const format = presetTransportFormat(preset, `Preset ${presetPath}`);

	const slug = `agent-render-${randomUUID()}`;
	const response = await fetch(`${APP_URL}/api/user-compositions/${encodeURIComponent(slug)}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(preset)
	});
	if (!response.ok) {
		throw new Error(`Preset import failed: ${await responseFailure(response)}`);
	}

	return {
		slug,
		format,
		cleanup: async () => {
			const cleanupResponse = await fetch(
				`${APP_URL}/api/user-compositions/${encodeURIComponent(slug)}`,
				{ method: 'DELETE' }
			);
			if (!cleanupResponse.ok && cleanupResponse.status !== 404) {
				throw new Error(
					`Temporary Preset cleanup failed: ${await responseFailure(cleanupResponse)}`
				);
			}
		}
	};
}

export async function withPreparedPreset<T>(
	presetInput: string,
	operation: (prepared: PreparedPreset) => Promise<T>
): Promise<T> {
	const prepared = await preparePreset(presetInput);
	try {
		return await operation(prepared);
	} finally {
		await prepared.cleanup();
	}
}

export async function renderJob(page: Page, job: RenderJob): Promise<void> {
	await withPreparedPreset(job.preset, async (prepared) => {
		assertOutputExtension(prepared.format, job.out);
		await page.goto(`${APP_URL}/p/${encodeURIComponent(prepared.slug)}`, {
			waitUntil: 'networkidle',
			timeout: READY_TIMEOUT_MS
		});
		// The Workspace names the composition it opened by slug on the topbar; the
		// visible text is the Preset's name, which rarely equals its slug.
		await page.waitForFunction(
			(slug) =>
				typeof (window as Window & { __gfxExport?: unknown }).__gfxExport === 'function' &&
				document.querySelector('.topbar__name')?.getAttribute('data-composition-slug') === slug,
			prepared.slug,
			{ timeout: READY_TIMEOUT_MS }
		);
		const outputPath = resolve(job.out);
		await mkdir(dirname(outputPath), { recursive: true });
		const downloadPromise = page.waitForEvent('download', { timeout: RENDER_TIMEOUT_MS });
		const exportPromise = page.evaluate(async (filename) => {
			const exportComposition = (
				window as Window & {
					__gfxExport?: (request: { filename: string }) => Promise<void>;
				}
			).__gfxExport;
			if (!exportComposition) throw new Error('Workspace export seam is unavailable.');
			await exportComposition({ filename });
		}, basename(outputPath));
		const [download] = await Promise.all([downloadPromise, exportPromise]);
		await download.saveAs(outputPath);
		const output = await stat(outputPath);
		if (output.size === 0) throw new Error(`Renderer produced an empty file at ${outputPath}.`);
		process.stdout.write(`${outputPath}\n`);
	});
}

export function parseBatchManifest(value: unknown, manifestPath: string): RenderJob[] {
	if (!Array.isArray(value)) {
		throw new TypeError('Batch manifest must be an array.');
	}
	const baseDirectory = dirname(manifestPath);
	return value.map((entry, index) => {
		if (
			typeof entry !== 'object' ||
			entry === null ||
			!('preset' in entry) ||
			!('out' in entry) ||
			typeof entry.preset !== 'string' ||
			typeof entry.out !== 'string'
		) {
			throw new TypeError(`Invalid batch job at index ${index}.`);
		}
		const preset =
			isFilePreset(entry.preset) && !isAbsolute(entry.preset)
				? resolve(baseDirectory, entry.preset)
				: entry.preset;
		const out = isAbsolute(entry.out) ? entry.out : resolve(baseDirectory, entry.out);
		return { preset, out };
	});
}

export async function runRenderJobs(
	page: Page,
	jobs: readonly RenderJob[],
	render: (page: Page, job: RenderJob) => Promise<void> = renderJob
): Promise<string[]> {
	const failures: string[] = [];
	for (const job of jobs) {
		try {
			await render(page, job);
		} catch (error) {
			failures.push(`${job.preset}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return failures;
}

export async function run(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);
	let jobs: RenderJob[];
	if (command === 'render') {
		jobs = [{ preset: readFlag(args, '--preset'), out: readFlag(args, '--out') }];
	} else if (command === 'batch') {
		const manifestPath = resolve(args[0] ?? usage());
		const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf-8'));
		jobs = parseBatchManifest(manifest, manifestPath);
	} else {
		usage();
	}

	await assertRuntimeAvailable();
	const browser = await connectCdpRenderBrowser(CDP_URL);
	const page = browser.page;
	let failures: string[];
	try {
		failures = await runRenderJobs(page, jobs);
	} finally {
		await page.close();
		await browser.disconnect();
	}

	if (failures.length > 0) {
		throw new Error(`Render failures:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
	}
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
	run().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
