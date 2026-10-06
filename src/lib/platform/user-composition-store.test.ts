import assert from 'node:assert/strict';

import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import type { Preset } from './engine-schema';
import { parsePresetIngress } from './preset-ingress';
import {
	LEGACY_SOURCE_VIDEO_ASSET_ID,
	LEGACY_SOURCE_VIDEO_CLIP_ID
} from './preset-ingress';
import { presetToWireFormat } from './preset-pure';
import { isUserCompositionNotHeldError } from './user-composition-store-errors';
import { userCompositionStore } from './user-composition-store';

const blankPreset: Preset = parsePresetIngress(blankPresetJson);
const fetchMock = vi.fn<typeof fetch>();

function mediaPreset(): Preset {
	return parsePresetIngress({
		...blankPresetJson,
		state: {
			...blankPresetJson.state,
			media: {
				assets: [
					{
						id: 'interview-asset',
						kind: 'video',
						name: 'Interview',
						assetUrl: `/api/user-assets/${'d'.repeat(64)}.webm`
					}
				],
				videoTrack: {
					clips: [
						{
							id: 'interview-clip',
							assetId: 'interview-asset',
							timelineStartFrame: 0,
							durationFrames: 90,
							sourceStartSeconds: 3,
							audio: { enabled: true, gain: 0.5 }
						}
					]
				}
			}
		}
	});
}

function chartPreset(): Preset {
	return parsePresetIngress({
		...blankPresetJson,
		state: {
			...blankPresetJson.state,
			surface: {
				...blankPresetJson.state.surface,
				chart: {
					mode: 'single',
					items: [
						{
							id: 'agent-chart',
							type: 'column-chart',
							title: 'Agent count',
							data: {
								categories: [{ id: 'multiple', label: '2–5' }],
								series: [
									{
										id: 'responses',
										label: 'Responses',
										values: [{ categoryId: 'multiple', value: 744 }]
									}
								]
							},
							layout: { mode: 'single' },
							domain: { min: 0, max: 800 },
							labels: { values: true, legend: false },
							fill: { role: 'default' },
							motion: {
								entry: { start: 0, duration: 0.1 },
								reveal: { start: 0.1, duration: 0.2 },
								emphasis: { start: 0.3, duration: 0.1 },
								annotation: { start: 0.4, duration: 0.1 },
								exit: { start: 0.9, duration: 0.1 }
							}
						}
					]
				}
			}
		}
	});
}

function legacySourceVideoPreset(): unknown {
	return {
		...blankPresetJson,
		state: {
			...blankPresetJson.state,
			sourceVideo: {
				assetUrl: `/api/user-assets/${'e'.repeat(64)}.mp4`,
				sourceOffsetSeconds: 2,
				includeAudio: false,
				volume: 0.8
			}
		}
	};
}

function jsonResponse(value: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { 'content-type': 'application/json' },
		...init
	});
}

function requestBodyAt(index: number): unknown {
	const requestInit = fetchMock.mock.calls[index]?.[1];
	const body = requestInit?.body;
	if (typeof body !== 'string') {
		throw new TypeError(`Expected request ${index} to carry a string body`);
	}
	return JSON.parse(body);
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('userCompositionStore', () => {
	it('lists User compositions with the collection GET and parses metadata', async () => {
		const metadata = [
			{
				slug: 'blank-copy',
				name: 'Blank copy',
				forkedFrom: 'blank',
				savedAt: '2026-07-21T12:00:00.000Z',
				posterKey: null,
				durationSeconds: blankPreset.state.transport.durationSeconds,
				surfaceType: blankPreset.state.surface.type,
				media: blankPreset.state.media,
				mediaStatus: 'ready'
			}
		];
		fetchMock.mockResolvedValueOnce(jsonResponse(metadata));

		const result = await userCompositionStore.listUserCompositions();

		assert.deepEqual(result, metadata);
		assert.deepEqual(fetchMock.mock.calls[0], ['/api/user-compositions']);
	});

	it('parses volatile readiness issues without adding them to canonical media', async () => {
		const preset = mediaPreset();
		const issue = {
			assetIds: ['interview-asset'],
			assetUrl: preset.state.media.assets[0].assetUrl,
			status: 'missing' as const,
			message: 'Referenced media asset "interview-asset" is missing.'
		};
		const metadata = {
			slug: 'missing-media',
			name: 'Missing media',
			forkedFrom: null,
			savedAt: '2026-07-21T12:00:00.000Z',
			posterKey: null,
			durationSeconds: preset.state.transport.durationSeconds,
			surfaceType: preset.state.surface.type,
			media: preset.state.media,
			mediaStatus: 'missing' as const,
			mediaIssues: [issue]
		};
		fetchMock.mockResolvedValueOnce(jsonResponse([metadata]));

		const result = await userCompositionStore.listUserCompositions();

		assert.deepEqual(result, [metadata]);
		assert.equal(Object.hasOwn(result[0].media, 'mediaStatus'), false);
		assert.equal(Object.hasOwn(result[0].media, 'mediaIssues'), false);
	});

	it('loads an encoded User composition slug and preserves null as the no-fork response', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(presetToWireFormat(blankPreset)))
			.mockResolvedValueOnce(jsonResponse(null));

		const loaded = await userCompositionStore.loadUserComposition('blank copy');
		const missing = await userCompositionStore.loadUserComposition('missing');

		assert.deepEqual(loaded, blankPreset);
		assert.equal(missing, null);
		assert.deepEqual(fetchMock.mock.calls[0], ['/api/user-compositions/blank%20copy']);
		assert.deepEqual(fetchMock.mock.calls[1], ['/api/user-compositions/missing']);
	});

	it('uses an explicit request fetch instead of global fetch when loading', async () => {
		const requestFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
			jsonResponse(presetToWireFormat(blankPreset))
		);

		const loaded = await userCompositionStore.loadUserComposition('request-scoped', requestFetch);

		assert.deepEqual(loaded, blankPreset);
		assert.deepEqual(requestFetch.mock.calls[0], ['/api/user-compositions/request-scoped']);
		assert.equal(fetchMock.mock.calls.length, 0);
	});

	it('forks with POST and serializes the standalone Preset to the existing wire format', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ slug: 'blank-copy' }, { status: 201 }));

		await userCompositionStore.forkUserComposition('blank-copy', blankPreset, 'blank');

		const [url, requestInit] = fetchMock.mock.calls[0];
		assert.equal(url, '/api/user-compositions');
		assert.equal(requestInit?.method, 'POST');
		assert.deepEqual(requestInit?.headers, { 'Content-Type': 'application/json' });
		const body = requestBodyAt(0) as {
			slug: unknown;
			preset: { state: { surface: { content: { body: unknown } } } };
			forkedFrom: unknown;
		};
		assert.equal(body.slug, 'blank-copy');
		assert.equal(body.forkedFrom, 'blank');
		assert.equal(body.preset.state.surface.content.body, '');
	});

	it('maps save and delete to the slug PUT and DELETE routes', async () => {
		fetchMock
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));

		await userCompositionStore.saveUserComposition('blank copy', blankPreset);
		await userCompositionStore.deleteUserComposition('blank copy');

		assert.equal(fetchMock.mock.calls[0]?.[0], '/api/user-compositions/blank%20copy');
		assert.equal(fetchMock.mock.calls[0]?.[1]?.method, 'PUT');
		const savedPreset = requestBodyAt(0) as {
			state: { surface: { content: { body: unknown } } };
		};
		assert.equal(savedPreset.state.surface.content.body, '');
		assert.deepEqual(fetchMock.mock.calls[1], [
			'/api/user-compositions/blank%20copy',
			{ method: 'DELETE' }
		]);
	});

	it('includes the operation, slug, status, and status text in HTTP failures', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(null, { status: 503, statusText: 'Store unavailable' })
		);

		await assert.rejects(
			userCompositionStore.loadUserComposition('blank-copy'),
			/Failed to load User composition "blank-copy": 503 Store unavailable/
		);
	});

	// The origin half of the reported revert defect: a delete of a slug this
	// origin never had has to be tellable apart from an origin that would not
	// answer, so reverting a fork that is already gone can finish.
	it('names a delete of a slug the origin does not hold as a not-held refusal', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ message: 'User composition "blank-copy" not found' }, { status: 404 })
		);

		await assert.rejects(userCompositionStore.deleteUserComposition('blank-copy'), (cause) => {
			assert.ok(isUserCompositionNotHeldError(cause));
			assert.equal(cause.slug, 'blank-copy');
			assert.match(cause.message, /404: User composition "blank-copy" not found/);
			return true;
		});
	});

	it('leaves an unreachable origin as an ordinary delete failure', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(null, { status: 503, statusText: 'Store unavailable' })
		);

		await assert.rejects(userCompositionStore.deleteUserComposition('blank-copy'), (cause) => {
			assert.equal(isUserCompositionNotHeldError(cause), false);
			assert.match(cause instanceof Error ? cause.message : '', /503 Store unavailable/);
			return true;
		});
	});

	it('includes an actionable API error message in HTTP failures', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ message: 'Invalid preset: state.surface is required' }, { status: 400 })
		);

		await assert.rejects(
			userCompositionStore.saveUserComposition('blank-copy', blankPreset),
			/400: Invalid preset: state\.surface is required/
		);
	});

	it('rejects malformed list, load, and JSON responses with parsing context', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse([{ slug: 'missing-fields' }]))
			.mockResolvedValueOnce(jsonResponse({ schema: 'not-gfx', state: {} }))
			.mockResolvedValueOnce(new Response('{broken json'));

		await assert.rejects(
			userCompositionStore.listUserCompositions(),
			/Failed to list User compositions: invalid entry at index 0/
		);
		await assert.rejects(
			userCompositionStore.loadUserComposition('invalid'),
			/Failed to load User composition "invalid": invalid response/
		);
		await assert.rejects(
			userCompositionStore.listUserCompositions(),
			/Failed to list User compositions: invalid JSON response/
		);
	});

	it('preserves canonical media through list, load, fork, and save transport', async () => {
		const preset = mediaPreset();
		const metadata = {
			slug: 'media-copy',
			name: 'Media copy',
			forkedFrom: 'blank',
			savedAt: '2026-07-27T12:00:00.000Z',
			posterKey: null,
			durationSeconds: preset.state.transport.durationSeconds,
			surfaceType: preset.state.surface.type,
			media: preset.state.media,
			mediaStatus: 'ready' as const
		};
		fetchMock
			.mockResolvedValueOnce(jsonResponse([metadata]))
			.mockResolvedValueOnce(jsonResponse(presetToWireFormat(preset)))
			.mockResolvedValueOnce(jsonResponse({ slug: 'media-copy' }, { status: 201 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));

		assert.deepEqual(await userCompositionStore.listUserCompositions(), [metadata]);
		assert.deepEqual(await userCompositionStore.loadUserComposition('media-copy'), preset);
		await userCompositionStore.forkUserComposition('media-copy', preset, 'blank');
		await userCompositionStore.saveUserComposition('media-copy', preset);

		const forkBody = requestBodyAt(2) as { preset: { state: Record<string, unknown> } };
		const saveBody = requestBodyAt(3) as { state: Record<string, unknown> };
		assert.deepEqual(forkBody.preset.state.media, preset.state.media);
		assert.deepEqual(saveBody.state.media, preset.state.media);
		assert.equal(Object.hasOwn(forkBody.preset.state, 'sourceVideo'), false);
		assert.equal(Object.hasOwn(saveBody.state, 'sourceVideo'), false);
	});

	it('preserves a valid chart through load, fork, and save and rejects invalid chart loads', async () => {
		const preset = chartPreset();
		const invalidWire = structuredClone(presetToWireFormat(preset)) as Preset;
		invalidWire.state.surface.chart!.items[0].domain = { min: 500, max: 800 };
		const unknownKeyWire = structuredClone(presetToWireFormat(preset)) as unknown as {
			state: { surface: { chart: { items: Array<Record<string, unknown>> } } };
		};
		unknownKeyWire.state.surface.chart.items[0]['literalColor'] = '#ff0000';
		fetchMock
			.mockResolvedValueOnce(jsonResponse(presetToWireFormat(preset)))
			.mockResolvedValueOnce(jsonResponse({ slug: 'agent-chart-copy' }, { status: 201 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(jsonResponse(invalidWire))
			.mockResolvedValueOnce(jsonResponse(unknownKeyWire));

		const loaded = await userCompositionStore.loadUserComposition('agent-chart');
		assert.ok(loaded);
		assert.deepEqual(loaded.state.surface.chart, preset.state.surface.chart);
		await userCompositionStore.forkUserComposition('agent-chart-copy', loaded, 'agent-chart');
		await userCompositionStore.saveUserComposition('agent-chart-copy', loaded);

		const forkBody = requestBodyAt(1) as { preset: Preset };
		const saveBody = requestBodyAt(2) as Preset;
		assert.deepEqual(forkBody.preset.state.surface.chart, preset.state.surface.chart);
		assert.deepEqual(saveBody.state.surface.chart, preset.state.surface.chart);
		await assert.rejects(
			userCompositionStore.loadUserComposition('invalid-chart'),
			/invalid response/
		);
		await assert.rejects(
			userCompositionStore.loadUserComposition('unknown-chart-key'),
			/invalid response/
		);
	});

	it('upgrades legacy Source video input to canonical media on the first autosave', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(legacySourceVideoPreset()))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));

		const loaded = await userCompositionStore.loadUserComposition('legacy-source');
		assert.ok(loaded);
		await userCompositionStore.saveUserComposition('legacy-source', loaded);

		const saveBody = requestBodyAt(1) as { state: Record<string, unknown> };
		assert.equal(Object.hasOwn(saveBody.state, 'sourceVideo'), false);
		assert.deepEqual(saveBody.state.media, {
			assets: [
				{
					id: LEGACY_SOURCE_VIDEO_ASSET_ID,
					kind: 'video',
					name: 'Source video',
					assetUrl: `/api/user-assets/${'e'.repeat(64)}.mp4`
				}
			],
			videoTrack: {
				clips: [
					{
						id: LEGACY_SOURCE_VIDEO_CLIP_ID,
						assetId: LEGACY_SOURCE_VIDEO_ASSET_ID,
						timelineStartFrame: 0,
						durationFrames: 180,
						sourceStartSeconds: 2,
						audio: { enabled: false, gain: 0.8 }
					}
				]
			}
		});
	});
});
