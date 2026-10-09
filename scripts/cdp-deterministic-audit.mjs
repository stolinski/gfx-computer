import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

import { readGfxEnvironmentValue } from '../src/lib/utils/legacy-supers-compatibility.ts';
import { classifyProbeOutputClass } from './_probe-output-class.ts';

// Child probes run from the repository, never from whatever directory invoked
// this audit — an inherited cwd is what pointed a probe at the real store.
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CDP_PORT = Number(process.env.CDP_PORT ?? 9223);
const BASE_URL = readGfxEnvironmentValue(process.env, 'GFX_BASE_URL') ?? 'http://localhost:7263';
const WAIT_MS = Number(process.env.CDP_DETERMINISTIC_WAIT_MS ?? 30000);
const OUTPUT_ROOT = process.env.CDP_DETERMINISTIC_OUTPUT ?? '.tmp-deterministic-audit';
const requestedSlugs = process.argv.slice(2);
const CASES =
	requestedSlugs.length > 0
		? requestedSlugs.map((slug) => ({ slug, frames: [30] }))
		: [
				{ slug: 'lower-third', frames: [60], zoom: true, expectedReadable: ['overlay:main:title'] },
				{ slug: 'counter-demo', frames: [60], expectedReadable: ['overlay:main:value'] },
				{
					slug: 'bar-chart-apollo-sample-return',
					frames: [90],
					expectedReadable: ['block:apollo-returned-sample-mass:title']
				},
				{ slug: 'chart-domain-survey-fixture', frames: [30, 90, 150, 210] },
				{
					slug: 'deterministic-imessage-readable-audit-fixture',
					frames: [90],
					expectedReadable: [
						'surface:imessage:author',
						'surface:imessage:chrome:timestamp',
						'surface:imessage:chrome:composer',
						'surface:imessage:message:0:tapback',
						'surface:imessage:message:1:status'
					]
				},
				{
					slug: 'web-document-github',
					frames: [90],
					expectedReadable: [
						'surface:web-document:source-url',
						'surface:web-document:title',
						'surface:web-document:chrome:issue-number',
						'surface:web-document:chrome:open-status',
						'surface:web-document:chrome:comment-author',
						'surface:web-document:chrome:owner-role'
					]
				},
				{ slug: 'captions-karaoke', frames: [45], expectedReadable: ['caption:cue-1'] },
				{
					slug: 'captions-word-pop',
					frames: [45],
					expectedReadablePrefixes: ['caption:cue-1:word:']
				},
				{
					slug: 'transition-wipe-demo',
					frames: [18],
					transition: true,
					expectedTransitionEndpoints: {
						from: ['overlay:main:glyph-0'],
						to: ['surface:newspaper:title']
					}
				},
				{ slug: 'deterministic-readable-audit-fixture', frames: [75], pixelProof: true }
			];

function decodeDataUrl(value) {
	const separator = value.indexOf(',');
	if (separator < 0) throw new Error('Malformed PNG data URL');
	return Buffer.from(value.slice(separator + 1), 'base64');
}

function runProbe(command, args, expectSuccess = true) {
	const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: 'utf8' });
	const passed = result.status === 0;
	if (passed !== expectSuccess) {
		throw new Error(
			`Probe ${command} ${args.join(' ')} ${expectSuccess ? 'failed' : 'unexpectedly passed'}: ${result.stderr || result.stdout}`
		);
	}
	return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function openCdpPage(slug) {
	const targetResponse = await fetch(
		`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`,
		{ method: 'PUT' }
	);
	if (!targetResponse.ok) throw new Error(`Could not create CDP target: ${targetResponse.status}`);
	const target = await targetResponse.json();
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.onopen = resolve;
		socket.onerror = reject;
	});
	let nextId = 1;
	const pending = new Map();
	socket.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (!message.id || !pending.has(message.id)) return;
		const request = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) request.reject(new Error(message.error.message));
		else request.resolve(message.result);
	};
	function send(method, params = {}) {
		const id = nextId++;
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
			socket.send(JSON.stringify({ id, method, params }));
		});
	}
	await Promise.all([send('Page.enable'), send('Runtime.enable')]);
	await send('Page.navigate', { url: `${BASE_URL}/p/${encodeURIComponent(slug)}` });
	const deadline = Date.now() + WAIT_MS;
	while (Date.now() < deadline) {
		const ready = await send('Runtime.evaluate', {
			expression: `document.readyState === 'complete' && typeof window.__captureGfxDeterministicRenderRegionManifest === 'function'`,
			returnByValue: true
		});
		if (ready.result?.value === true) return { socket, send };
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`${slug}: deterministic audit seam did not become ready`);
}

async function evaluate(send, expression) {
	const response = await send('Runtime.evaluate', {
		expression,
		awaitPromise: true,
		returnByValue: true
	});
	if (response.exceptionDetails) {
		throw new Error(response.exceptionDetails.exception?.description ?? 'CDP evaluation failed');
	}
	return response.result.value;
}

async function captureFrame(send, frameIndex) {
	return evaluate(
		send,
		`window.__captureGfxDeterministicRenderRegionManifest({ address: { frameIndex: ${frameIndex}, timestampMicroseconds: Math.round(${frameIndex} * 1000000 / 30) }, frameRate: { num: 30, den: 1 } })`
	);
}

async function captureCanvasPngDataUrl(send) {
	return evaluate(
		send,
		`(async () => {
		const canvas = document.querySelector('canvas');
		if (!canvas) throw new Error('Canvas unavailable');
		const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
		if (!blob) throw new Error('Canvas PNG unavailable');
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onerror = () => reject(reader.error);
			reader.onload = () => resolve(reader.result);
			reader.readAsDataURL(blob);
		});
	})()`
	);
}

function saveCanvasPng(slug, suffix, dataUrl) {
	const directory = join(OUTPUT_ROOT, slug);
	mkdirSync(directory, { recursive: true });
	const path = join(directory, `canvas-${suffix}.png`);
	writeFileSync(path, decodeDataUrl(dataUrl));
	return path;
}

async function saveReadableArtifacts(send, slug, manifest, readableId, suffix) {
	const artifacts = await evaluate(
		send,
		`window.__captureGfxDeterministicReadablePngArtifacts(${JSON.stringify(readableId)})`
	);
	if (!artifacts) throw new Error(`${slug}:${readableId}: PNG artifacts unavailable`);
	const directory = join(OUTPUT_ROOT, slug);
	mkdirSync(directory, { recursive: true });
	const safe = readableId.replace(/[^a-z0-9_-]+/gi, '-');
	const paths = {
		background: join(directory, `${safe}-${suffix}-background.png`),
		treatment: join(directory, `${safe}-${suffix}-treatment.png`),
		mask: join(directory, `${safe}-${suffix}-mask.png`),
		binding: join(directory, `${safe}-${suffix}-binding.json`)
	};
	writeFileSync(paths.background, decodeDataUrl(artifacts.backgroundPng));
	writeFileSync(paths.treatment, decodeDataUrl(artifacts.treatmentPng));
	writeFileSync(paths.mask, decodeDataUrl(artifacts.authoritativeMaskPng));
	const evidence = manifest.readableIdentityEvidence.find((entry) => entry.id === readableId);
	if (!evidence?.capture)
		throw new Error(`${slug}:${readableId}: exact capture binding unavailable`);
	writeFileSync(
		paths.binding,
		JSON.stringify({
			...evidence.capture.binding,
			backgroundSha256: evidence.capture.backgroundSha256,
			treatmentSha256: evidence.capture.treatmentSha256,
			authoritativeMaskSha256: evidence.capture.authoritativeMaskSha256
		})
	);
	return { paths, evidence };
}

async function runCase(testCase) {
	const { socket, send } = await openCdpPage(testCase.slug);
	try {
		const rejected = await evaluate(
			send,
			`(async () => {
				const capture = window.__captureGfxDeterministicRenderRegionManifest;
				let wrongRate = false;
				let wrongTimestamp = false;
				try { await capture({ address: { frameIndex: 0, timestampMicroseconds: 0 }, frameRate: { num: 60, den: 1 } }); } catch { wrongRate = true; }
				try { await capture({ address: { frameIndex: 15, timestampMicroseconds: 1 }, frameRate: { num: 30, den: 1 } }); } catch { wrongTimestamp = true; }
				return { wrongRate, wrongTimestamp };
			})()`
		);
		if (!rejected.wrongRate || !rejected.wrongTimestamp) {
			throw new Error(`${testCase.slug}: invalid frame authority was accepted`);
		}
		const manifests = [];
		for (const frame of testCase.frames) manifests.push(await captureFrame(send, frame));
		for (const manifest of manifests) {
			if (manifest.readingPlan.status !== 'available' || !manifest.readingPlanDigest) {
				throw new Error(`${testCase.slug}: Preset-derived reading plan unavailable`);
			}
			if (!manifest.readableCoverage.complete) {
				throw new Error(
					`${testCase.slug}: readable coverage unavailable: ${manifest.readableCoverage.unavailableReason}`
				);
			}
			if (
				manifest.readableIdentityEvidence.some(
					(entry) =>
						entry.contrastMaskAuthority !== 'available' ||
						entry.compositedOcclusionMaskAuthority !== 'available' ||
						!entry.capture
				)
			) {
				throw new Error(`${testCase.slug}: exact readable pixel authority unavailable`);
			}
			if (manifest.shadowCoverage.authority !== 'renderer-owner') {
				throw new Error(`${testCase.slug}: unowned shadow discovered`);
			}
			const expectedIds = manifest.readableCoverage.expectedReadableIdentities;
			for (const expectedId of testCase.expectedReadable ?? []) {
				if (!expectedIds.includes(expectedId)) {
					throw new Error(`${testCase.slug}: missing typed readable identity ${expectedId}`);
				}
			}
			for (const prefix of testCase.expectedReadablePrefixes ?? []) {
				if (!expectedIds.some((id) => id.startsWith(prefix))) {
					throw new Error(`${testCase.slug}: missing typed readable identity prefix ${prefix}`);
				}
			}
		}
		if (testCase.zoom) {
			const before = manifests[0].readableRegions;
			const beforeGeometry = await evaluate(
				send,
				`(() => {
					const canvas = document.querySelector('canvas');
					const control = document.querySelector('[aria-label="Zoom in"]');
					if (!canvas || !(control instanceof HTMLButtonElement)) return null;
					const rect = canvas.getBoundingClientRect();
					return { cssWidth: rect.width, cssHeight: rect.height, nativeWidth: canvas.width, nativeHeight: canvas.height };
				})()`
			);
			if (!beforeGeometry) throw new Error(`${testCase.slug}: zoom control or canvas unavailable`);
			const clicked = await evaluate(
				send,
				`(() => { const control = document.querySelector('[aria-label="Zoom in"]'); if (!(control instanceof HTMLButtonElement)) return false; control.click(); return true; })()`
			);
			if (!clicked) throw new Error(`${testCase.slug}: zoom control did not exist`);
			await new Promise((resolve) => setTimeout(resolve, 250));
			const afterManifest = await captureFrame(send, testCase.frames[0]);
			const after = afterManifest.readableRegions;
			const afterGeometry = await evaluate(
				send,
				`(() => { const canvas = document.querySelector('canvas'); const rect = canvas.getBoundingClientRect(); return { cssWidth: rect.width, cssHeight: rect.height, nativeWidth: canvas.width, nativeHeight: canvas.height }; })()`
			);
			if (
				afterGeometry.cssWidth === beforeGeometry.cssWidth ||
				afterGeometry.cssHeight === beforeGeometry.cssHeight
			) {
				throw new Error(`${testCase.slug}: zoom did not change CSS canvas geometry`);
			}
			if (
				afterGeometry.nativeWidth !== beforeGeometry.nativeWidth ||
				afterGeometry.nativeHeight !== beforeGeometry.nativeHeight ||
				JSON.stringify(before) !== JSON.stringify(after)
			) {
				throw new Error(`${testCase.slug}: native coordinates changed under preview zoom`);
			}
		}
		const summary = { slug: testCase.slug, frames: testCase.frames, probes: [] };
		if (testCase.transition) {
			const endpointEvidence = manifests[0].transitionEndpoints ?? [];
			for (const endpoint of ['from', 'to']) {
				const evidence = endpointEvidence.find((entry) => entry.endpoint === endpoint);
				if (!evidence?.manifest.readableCoverage.complete) {
					throw new Error(`${testCase.slug}: ${endpoint} endpoint readable coverage unavailable`);
				}
				for (const expectedId of testCase.expectedTransitionEndpoints?.[endpoint] ?? []) {
					if (!evidence.manifest.readableCoverage.expectedReadableIdentities.includes(expectedId)) {
						throw new Error(`${testCase.slug}: ${endpoint} endpoint missing ${expectedId}`);
					}
					const identity = evidence.manifest.readableIdentityEvidence.find(
						(entry) => entry.id === expectedId
					);
					if (!identity?.capture || identity.capture.expectedTreatmentPixelCount <= 0) {
						throw new Error(
							`${testCase.slug}: ${endpoint} endpoint mask missing for ${expectedId}`
						);
					}
				}
			}
			const frame = testCase.frames[0];
			const address = manifests[0].address;
			const firstPath = saveCanvasPng(
				testCase.slug,
				`${frame}-first`,
				await captureCanvasPngDataUrl(send)
			);
			await captureFrame(send, frame);
			const secondPath = saveCanvasPng(
				testCase.slug,
				`${frame}-second`,
				await captureCanvasPngDataUrl(send)
			);
			await captureFrame(send, frame + 1);
			const adjacentPath = saveCanvasPng(
				testCase.slug,
				`${frame + 1}`,
				await captureCanvasPngDataUrl(send)
			);
			const addressArgs = [
				'--frame',
				String(address.frameIndex),
				'--timestamp-us',
				String(address.timestampMicroseconds)
			];
			summary.probes.push(
				runProbe(process.execPath, [
					'--experimental-strip-types',
					'scripts/probe-render-replay.ts',
					firstPath,
					secondPath,
					...addressArgs
				])
			);
			summary.probes.push(
				runProbe(
					process.execPath,
					[
						'--experimental-strip-types',
						'scripts/probe-render-replay.ts',
						firstPath,
						adjacentPath,
						...addressArgs
					],
					false
				)
			);
		}
		if (testCase.pixelProof) {
			const manifest = manifests[0];
			const occlusionTarget = manifest.readableIdentityEvidence.find((entry) =>
				entry.id.startsWith('overlay:readable-target:title')
			);
			const target = manifest.readableIdentityEvidence.find((entry) =>
				entry.id.startsWith('overlay:later-occluder:title')
			);
			if (!occlusionTarget || !target) {
				throw new Error(`${testCase.slug}: readable occlusion or contrast target unavailable`);
			}
			if (
				!occlusionTarget.capture ||
				occlusionTarget.capture.visibleTreatmentPixelCount >=
					occlusionTarget.capture.expectedTreatmentPixelCount
			) {
				throw new Error(
					`${testCase.slug}: real later-painted occluder produced no affected target pixels`
				);
			}
			const first = await saveReadableArtifacts(send, testCase.slug, manifest, target.id, 'first');
			const replayAddressArgs = [
				'--frame',
				String(manifest.address.frameIndex),
				'--timestamp-us',
				String(manifest.address.timestampMicroseconds)
			];
			const region = target.region.rect;
			const regionArg = `${region.x},${region.y},${region.width},${region.height}`;
			summary.probes.push(
				runProbe(process.execPath, [
					'--experimental-strip-types',
					'scripts/probe-local-contrast.ts',
					first.paths.background,
					'--treatment',
					first.paths.treatment,
					'--mask',
					first.paths.mask,
					'--binding',
					first.paths.binding,
					'--region',
					regionArg,
					'--class',
					target.textMeasurement.textClass
				])
			);
			const textEdgeProbe = runProbe(process.execPath, [
				'--experimental-strip-types',
				'scripts/probe-text-edge.ts',
				first.paths.treatment,
				'--region',
				regionArg
			]);
			const textEdge = JSON.parse(textEdgeProbe.stdout);
			if (textEdge.transition_count <= 0 || textEdge.max_step_normalized < 0.3) {
				throw new Error(`${testCase.slug}: text edge pixel probe failed ${textEdgeProbe.stdout}`);
			}
			summary.probes.push(textEdgeProbe);
			const edge = manifest.selectedProbeRegions['non-axis-edge'];
			if (!edge) throw new Error(`${testCase.slug}: non-axis edge region unavailable`);
			const edgeProbe = runProbe(process.execPath, [
				'--experimental-strip-types',
				'scripts/probe-edge-aa.ts',
				first.paths.treatment,
				'--region',
				`${edge.rect.x},${edge.rect.y},${edge.rect.width},${edge.rect.height}`,
				...(edge.excludedTextRects ?? []).flatMap((rect) => [
					'--exclude-region',
					`${rect.x},${rect.y},${rect.width},${rect.height}`
				])
			]);
			const edgeMeasurement = JSON.parse(edgeProbe.stdout);
			if (edgeMeasurement.transition_sample_count <= 0 || edgeMeasurement.hard_stairsteps !== 0) {
				throw new Error(`${testCase.slug}: edge-AA pixel probe failed ${edgeProbe.stdout}`);
			}
			summary.probes.push(edgeProbe);
			const shadow = manifest.probeRegions.find((region) =>
				region.id.startsWith('shadow:overlay:readable-target:accent:')
			);
			if (!shadow?.excludedRect)
				throw new Error(`${testCase.slug}: real 50%-opacity shadow region unavailable`);
			const bandingProbe = runProbe(process.execPath, [
				'--experimental-strip-types',
				'scripts/probe-banding.ts',
				first.paths.treatment,
				'--region',
				`${shadow.rect.x},${shadow.rect.y},${shadow.rect.width},${shadow.rect.height}`,
				'--exclude-region',
				`${shadow.excludedRect.x},${shadow.excludedRect.y},${shadow.excludedRect.width},${shadow.excludedRect.height}`
			]);
			const banding = JSON.parse(bandingProbe.stdout);
			if (
				banding.transition_sample_count <= 0 ||
				banding.band_count !== 0 ||
				banding.max_relative_step > 0.3
			) {
				throw new Error(`${testCase.slug}: real shadow pixel probe failed ${bandingProbe.stdout}`);
			}
			summary.probes.push(bandingProbe);
			await captureFrame(send, 5);
			const replayManifest = await captureFrame(send, testCase.frames[0]);
			const second = await saveReadableArtifacts(
				send,
				testCase.slug,
				replayManifest,
				target.id,
				'second'
			);
			summary.probes.push(
				runProbe(process.execPath, [
					'--experimental-strip-types',
					'scripts/probe-render-replay.ts',
					first.paths.treatment,
					second.paths.treatment,
					...replayAddressArgs
				])
			);
			summary.probes.push(
				runProbe(
					process.execPath,
					[
						'--experimental-strip-types',
						'scripts/probe-render-replay.ts',
						first.paths.background,
						first.paths.treatment,
						...replayAddressArgs
					],
					false
				)
			);
			const edgePng = PNG.sync.read(decodeDataUrl(await captureCanvasPngDataUrl(send)));
			if (classifyProbeOutputClass(edgePng) !== 'transparent') {
				throw new Error(`${testCase.slug}: every frame-edge pixel must be transparent`);
			}
		}
		return summary;
	} finally {
		await send('Page.close').catch(() => undefined);
		socket.close();
	}
}

const results = [];
for (const testCase of CASES) results.push(await runCase(testCase));
console.log(JSON.stringify({ results, verdict: 'pass' }, null, 2));
