import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateLayoutContractFrame } from '../src/lib/platform/layout-contract.ts';
import {
	computeRepositoryScopedTreeFingerprint,
	computeRepositoryTreeFingerprint
} from '../src/lib/utils/repository-tree-fingerprint.server.ts';
import { readGfxEnvironmentValue } from '../src/lib/utils/legacy-supers-compatibility.ts';
import { deriveGfxRenderMatrixManifest } from './derive-gfx-render-matrix-manifest.ts';
import { groupGfxRenderMatrixCoordinates } from './gfx-render-matrix-runner.ts';

// Children run from the repository, never from the directory that invoked this.
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = readGfxEnvironmentValue(process.env, 'GFX_BASE_URL') ?? 'http://localhost:7263';
const CHROME =
	readGfxEnvironmentValue(process.env, 'GFX_LAYOUT_CONTRACT_CHROME') ??
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WAIT_MS = Number(
	readGfxEnvironmentValue(process.env, 'GFX_LAYOUT_CONTRACT_WAIT_MS') ?? 60_000
);
const MATRIX_TIMEOUT_MS = Number(
	readGfxEnvironmentValue(process.env, 'GFX_LAYOUT_CONTRACT_TIMEOUT_MS') ?? 12 * 60_000
);
const DIAGNOSTIC_PRESET_SLUG =
	readGfxEnvironmentValue(process.env, 'GFX_LAYOUT_CONTRACT_PRESET')?.trim() || null;
const COMMAND_ARGUMENTS = process.argv.slice(2);
const SUMMARY_ONLY = COMMAND_ARGUMENTS.includes('--summary');

function parseScopedPaths() {
	const flagIndex = COMMAND_ARGUMENTS.indexOf('--scoped-paths-json');
	if (flagIndex < 0) return null;
	const serializedPaths = COMMAND_ARGUMENTS[flagIndex + 1];
	if (!serializedPaths) throw new TypeError('--scoped-paths-json requires a JSON array');
	const paths = JSON.parse(serializedPaths);
	if (
		!Array.isArray(paths) ||
		paths.length === 0 ||
		paths.some(
			(path) =>
				typeof path !== 'string' ||
				path.length === 0 ||
				path.startsWith('/') ||
				path.split('/').includes('..')
		)
	) {
		throw new TypeError('--scoped-paths-json must contain safe project-relative paths');
	}
	return [...new Set(paths)].sort();
}

const SCOPED_PATHS = parseScopedPaths();

function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, child]) => child !== undefined)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, canonicalize(child)])
		);
	}
	return value;
}

function hash(value) {
	return createHash('sha256')
		.update(JSON.stringify(canonicalize(value)))
		.digest('hex');
}

function gitHead() {
	const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
		cwd: repositoryRoot,
		encoding: 'utf8'
	});
	if (result.status !== 0) throw new Error('Unable to read repository HEAD');
	return result.stdout.trim();
}

async function waitForFile(path, deadline) {
	while (Date.now() < deadline) {
		try {
			return await readFile(path, 'utf8');
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
	throw new Error(`Timed out waiting for ${path}`);
}

async function assertServedSourceIdentity(sourceRevision, treeFingerprint) {
	const response = await fetch(`${BASE_URL}/api/verification/source-identity`);
	if (!response.ok) throw new Error(`Served source identity unavailable (${response.status})`);
	const identity = await response.json();
	if (identity.sourceRevision !== sourceRevision || identity.treeFingerprint !== treeFingerprint) {
		throw new Error('Served source identity does not match the clean committed checkout');
	}
}

async function launchHeadlessLayoutChrome() {
	const profile = await mkdtemp(join(tmpdir(), 'gfx-layout-contract-chrome-'));
	const child = spawn(
		CHROME,
		[
			'--headless=new',
			'--hide-scrollbars',
			'--mute-audio',
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-background-networking',
			'--disable-background-timer-throttling',
			'--disable-renderer-backgrounding',
			'--enable-blink-features=CanvasDrawElement',
			'--enable-unsafe-webgpu',
			'--remote-debugging-port=0',
			`--user-data-dir=${profile}`,
			'about:blank'
		],
		{ cwd: repositoryRoot, stdio: 'ignore' }
	);
	const activePort = await waitForFile(join(profile, 'DevToolsActivePort'), Date.now() + WAIT_MS);
	const [portText] = activePort.trim().split('\n');
	const port = Number(portText);
	if (!Number.isInteger(port) || port <= 0)
		throw new Error('Headless Chrome returned an invalid port');
	return {
		port,
		async close() {
			child.kill('SIGTERM');
			await Promise.race([
				new Promise((resolve) => child.once('exit', resolve)),
				new Promise((resolve) => setTimeout(resolve, 1_000))
			]);
			if (child.exitCode === null) child.kill('SIGKILL');
			// Chrome keeps flushing its profile for a moment after exit, so a single
			// removal can race it and fail a matrix that already finished.
			await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
		}
	};
}

async function waitForLayoutRuntime(send, presetSlug) {
	const deadline = Date.now() + WAIT_MS;
	while (Date.now() < deadline) {
		const ready = await send('Runtime.evaluate', {
			expression:
				"document.readyState === 'complete' && typeof window.__configureGfxDeterministicRenderCell === 'function' && typeof window.__captureGfxLayoutContractFrame === 'function' && typeof window.__captureGfxDeterministicFrameGeometry === 'function'",
			returnByValue: true
		});
		if (ready.result?.value === true) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`${presetSlug}: Layout Contract runtime did not become ready`);
}

async function openPage(port, presetSlug) {
	const response = await fetch(
		`http://localhost:${port}/json/new?${encodeURIComponent('about:blank')}`,
		{
			method: 'PUT'
		}
	);
	if (!response.ok) throw new Error(`Could not create hidden CDP target (${response.status})`);
	const target = await response.json();
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('Hidden CDP socket did not open')), WAIT_MS);
		socket.onopen = () => {
			clearTimeout(timeout);
			resolve();
		};
		socket.onerror = (error) => {
			clearTimeout(timeout);
			reject(error);
		};
	});
	let nextId = 1;
	const pending = new Map();
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			const timeout = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`CDP ${method} timed out`));
			}, WAIT_MS);
			pending.set(id, { resolve, reject, timeout });
			socket.send(JSON.stringify({ id, method, params }));
		});
	socket.onmessage = (event) => {
		const message = JSON.parse(String(event.data));
		if (!message.id) return;
		const request = pending.get(message.id);
		if (!request) return;
		pending.delete(message.id);
		clearTimeout(request.timeout);
		if (message.error) request.reject(new Error(message.error.message));
		else request.resolve(message.result);
	};
	await send('Page.enable');
	await send('Runtime.enable');
	await send('Page.navigate', {
		url: `${BASE_URL}/p/${encodeURIComponent(presetSlug)}?source=builtin`
	});
	try {
		await waitForLayoutRuntime(send, presetSlug);
		return { targetId: target.id, socket, send };
	} catch (error) {
		socket.close();
		throw error;
	}
}

async function evaluate(send, expression) {
	const response = await send('Runtime.evaluate', {
		expression,
		awaitPromise: true,
		returnByValue: true
	});
	if (response.exceptionDetails) {
		throw new Error(
			response.exceptionDetails.exception?.description ?? 'Browser evaluation failed'
		);
	}
	return response.result?.value;
}

async function closePage(port, page) {
	page.socket.close();
	await fetch(`http://localhost:${port}/json/close/${encodeURIComponent(page.targetId)}`).catch(
		() => undefined
	);
}

function maximumGeometryDelta(frames, candidateIds) {
	if (candidateIds.length === 0) return 0;
	let maximum = 0;
	for (const candidateId of candidateIds) {
		const rects = frames.map((frame) => frame.elements[candidateId]);
		if (rects.some((rect) => !rect)) {
			throw new Error(`Stable geometry candidate ${candidateId} was not measurable`);
		}
		const first = rects[0];
		for (const rect of rects.slice(1)) {
			maximum = Math.max(
				maximum,
				Math.abs(rect.x - first.x),
				Math.abs(rect.y - first.y),
				Math.abs(rect.width - first.width),
				Math.abs(rect.height - first.height)
			);
		}
	}
	return maximum;
}

function frameEvidence(coordinate, primary, replay, auxiliary) {
	const manifest = primary.manifest;
	return {
		schemaVersion: 1,
		coordinate: {
			presetSlug: coordinate.presetSlug,
			packId: coordinate.packId,
			orientation: coordinate.orientation,
			frameIndex: coordinate.sample.frameIndex,
			timestampMicroseconds: coordinate.sample.timestampMicroseconds,
			width: coordinate.width,
			height: coordinate.height
		},
		pendingFontCount: manifest.pendingFontCount,
		readableCoverage: manifest.readableCoverage,
		readables: manifest.readableIdentityEvidence.map((entry) => ({
			id: entry.id,
			textRole: entry.textMeasurement.textRole,
			rect: entry.region.rect,
			clipRect: entry.region.clipRect,
			measuredCapHeightPixels: entry.textMeasurement.measuredCapHeightPixels,
			clippedPixelCount: entry.clippedPixelCount
		})),
		readingPlan: manifest.readingPlan,
		measurements: {
			titleSafeAreaAffectedPixels: manifest.measurements.titleSafeAreaAffectedPixels,
			verticalPlatformSafeAreaAffectedPixels:
				manifest.measurements.verticalPlatformSafeAreaAffectedPixels
		},
		canonicalGeometryDigest: hash(primary.geometry),
		replayGeometryDigest: hash(replay.geometry),
		stableGeometryCandidateCount: coordinate.sample.stableGeometryCandidateIds.length,
		maximumElementDeltaPixels: maximumGeometryDelta(
			[primary.geometry, ...auxiliary.map((frame) => frame.geometry)],
			coordinate.sample.stableGeometryCandidateIds
		)
	};
}

async function captureFrame(send, coordinate, frameIndex) {
	const timestampMicroseconds = Math.round(
		(frameIndex * coordinate.frameRate.den * 1_000_000) / coordinate.frameRate.num
	);
	const request = {
		address: { frameIndex, timestampMicroseconds },
		frameRate: coordinate.frameRate
	};
	const manifest = await evaluate(
		send,
		`window.__captureGfxLayoutContractFrame(${JSON.stringify(request)})`
	);
	const geometry = await evaluate(
		send,
		`window.__captureGfxDeterministicFrameGeometry(${JSON.stringify(coordinate.sample.stableGeometryCandidateIds)})`
	);
	return { manifest, geometry };
}

async function run() {
	const startedAt = new Date().toISOString();
	const deadline = Date.now() + MATRIX_TIMEOUT_MS;
	const sourceRevision = gitHead();
	const servedTree = await computeRepositoryTreeFingerprint(process.cwd());
	const receiptTree = SCOPED_PATHS
		? await computeRepositoryScopedTreeFingerprint(process.cwd(), SCOPED_PATHS)
		: servedTree;
	const collected = await deriveGfxRenderMatrixManifest({
		sourceRevision,
		engineFingerprint: servedTree.treeFingerprint,
		scope: 'full'
	});
	if (!collected.manifest)
		throw new Error('Full Layout Contract selection produced no coordinates');
	await assertServedSourceIdentity(sourceRevision, servedTree.treeFingerprint);
	const coordinates = DIAGNOSTIC_PRESET_SLUG
		? collected.manifest.coordinates.filter(
				(coordinate) => coordinate.presetSlug === DIAGNOSTIC_PRESET_SLUG
			)
		: collected.manifest.coordinates;
	if (coordinates.length === 0) {
		throw new Error(`Unknown diagnostic Preset ${DIAGNOSTIC_PRESET_SLUG}`);
	}
	const chrome = await launchHeadlessLayoutChrome();
	const frameResults = [];
	try {
		for (const group of groupGfxRenderMatrixCoordinates(coordinates)) {
			if (Date.now() >= deadline) throw new Error('Layout Contract matrix exceeded 12 minutes');
			const page = await openPage(chrome.port, group.presetSlug);
			try {
				const runtime = await evaluate(
					page.send,
					'window.__readGfxRuntimeRenderRegistryIdentity()'
				);
				const expectedRuntime = {
					deliverablePresets: collected.snapshot.deliverablePresets.map((entry) => ({
						id: entry.slug,
						fingerprint: entry.presetFingerprint
					})),
					packs: collected.snapshot.packs.map((entry) => ({
						id: entry.id,
						fingerprint: entry.packFingerprint
					}))
				};
				if (
					JSON.stringify(runtime.deliverablePresets) !==
						JSON.stringify(expectedRuntime.deliverablePresets) ||
					JSON.stringify(runtime.packs) !== JSON.stringify(expectedRuntime.packs)
				) {
					throw new Error('Hidden browser registry differs from the immutable matrix snapshot');
				}
				for (const coordinate of group.coordinates) {
					if (Date.now() >= deadline) throw new Error('Layout Contract matrix exceeded 12 minutes');
					const configuration = await evaluate(
						page.send,
						`window.__configureGfxDeterministicRenderCell(${JSON.stringify({ presetSlug: coordinate.presetSlug, packId: coordinate.packId, orientation: coordinate.orientation })})`
					);
					if (
						configuration.width !== coordinate.width ||
						configuration.height !== coordinate.height
					) {
						throw new Error(`${coordinate.cellId}: configured native target mismatch`);
					}
					await waitForLayoutRuntime(page.send, coordinate.presetSlug);
					const primary = await captureFrame(page.send, coordinate, coordinate.sample.frameIndex);
					const replay = await captureFrame(page.send, coordinate, coordinate.sample.frameIndex);
					const auxiliary = [];
					for (const frameIndex of coordinate.sample.auxiliaryFrameIndices) {
						if (frameIndex === coordinate.sample.frameIndex) continue;
						auxiliary.push(await captureFrame(page.send, coordinate, frameIndex));
					}
					frameResults.push(
						evaluateLayoutContractFrame(frameEvidence(coordinate, primary, replay, auxiliary))
					);
				}
			} finally {
				await closePage(chrome.port, page);
			}
		}
	} finally {
		await chrome.close();
	}
	const failureCountMap = new Map();
	for (const result of frameResults) {
		for (const check of result.checks) {
			if (check.outcome === 'pass' || check.outcome === 'not-applicable') continue;
			const key = `${check.code}:${check.outcome}`;
			failureCountMap.set(key, (failureCountMap.get(key) ?? 0) + 1);
		}
	}
	const failureCounts = [...failureCountMap]
		.map(([key, count]) => {
			const separator = key.lastIndexOf(':');
			return { code: key.slice(0, separator), outcome: key.slice(separator + 1), count };
		})
		.sort((left, right) =>
			`${left.code}:${left.outcome}`.localeCompare(`${right.code}:${right.outcome}`)
		);
	const summary = {
		schemaVersion: 1,
		sourceRevision,
		treeFingerprint: receiptTree.treeFingerprint,
		manifestDigest: collected.manifest.manifestDigest,
		authoritativeFullCorpus: DIAGNOSTIC_PRESET_SLUG === null,
		diagnosticPresetSlug: DIAGNOSTIC_PRESET_SLUG,
		startedAt,
		completedAt: new Date().toISOString(),
		coordinateCount: frameResults.length,
		passedCount: frameResults.filter((result) => result.passed).length,
		failedCount: frameResults.filter((result) => !result.passed).length,
		failureCounts,
		passed: frameResults.every((result) => result.passed),
		frameResults
	};
	const report = { ...summary, contentDigest: hash(summary) };
	const output = SUMMARY_ONLY
		? {
				schemaVersion: report.schemaVersion,
				sourceRevision: report.sourceRevision,
				treeFingerprint: report.treeFingerprint,
				manifestDigest: report.manifestDigest,
				authoritativeFullCorpus: report.authoritativeFullCorpus,
				diagnosticPresetSlug: report.diagnosticPresetSlug,
				startedAt: report.startedAt,
				completedAt: report.completedAt,
				coordinateCount: report.coordinateCount,
				passedCount: report.passedCount,
				failedCount: report.failedCount,
				failureCounts: report.failureCounts,
				passed: report.passed,
				contentDigest: report.contentDigest
			}
		: report;
	process.stdout.write(`${JSON.stringify(output)}\n`);
	if (!report.passed) process.exitCode = 1;
}

await run();
