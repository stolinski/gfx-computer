import assert from 'node:assert/strict';

import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import type { Preset } from './engine-schema';
import { filmFromPreset, filmToWireFormat } from './film-ingress';
import { parsePresetIngress } from './preset-ingress';
import { LEGACY_SOURCE_VIDEO_ASSET_ID, LEGACY_SOURCE_VIDEO_CLIP_ID } from './preset-ingress';
import { presetToWireFormat } from './preset-pure';
import {
	isUserCompositionNotHeldError,
	isUserCompositionStarterSlugError
} from './user-composition-store-errors';
import { userCompositionStore } from './user-composition-store';

import type { UserCompositionDocument } from './user-composition-record';

const blankPreset: Preset = parsePresetIngress({ ...blankPresetJson, kind: 'deliverable' });
const fetchMock = vi.fn<typeof fetch>();

/** The document a Preset is stored as: a one-Scene Film, seeded from `starterSlug` or nothing. */
function documentOf(preset: Preset, starterSlug: string | null = null): UserCompositionDocument {
	return {
		film: filmFromPreset(
			preset,
			starterSlug === null ? null : { slug: starterSlug, contentKey: null }
		),
		legacyPresetEnvelope: { kind: 'deliverable' }
	};
}

/** The standalone Film document the origin answers a slug GET with. */
function standaloneFilmOf(preset: Preset, starterSlug: string | null = null): unknown {
	return filmToWireFormat(documentOf(preset, starterSlug).film);
}

function mediaPreset(): Preset {
	return parsePresetIngress({
		...blankPresetJson,
		kind: 'deliverable',
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
		kind: 'deliverable',
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

	it('loads an encoded User composition slug as a Film and preserves null as the nothing-stored response', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(standaloneFilmOf(blankPreset, 'blank')))
			.mockResolvedValueOnce(jsonResponse(null));

		const loaded = await userCompositionStore.loadUserComposition('blank copy');
		const missing = await userCompositionStore.loadUserComposition('missing');

		assert.deepEqual(loaded, documentOf(blankPreset, 'blank'));
		// The Scene keeps the origin the record stored.
		assert.deepEqual(loaded?.film.scenes[0].origin, { slug: 'blank', contentKey: null });
		assert.equal(missing, null);
		assert.deepEqual(fetchMock.mock.calls[0], ['/api/user-compositions/blank%20copy']);
		assert.deepEqual(fetchMock.mock.calls[1], ['/api/user-compositions/missing']);
	});

	it('loads a legacy transition record with its recipe in the envelope', async () => {
		const transitionPreset = parsePresetIngress({
			...blankPresetJson,
			kind: 'deliverable',
			transition: {
				from: 'lower-third',
				to: 'blank',
				effect: 'mask-wipe',
				durationMs: 600,
				params: {}
			}
		});
		fetchMock
			.mockResolvedValueOnce(jsonResponse(presetToWireFormat(transitionPreset)))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));

		const loaded = await userCompositionStore.loadUserComposition('my-transition');
		assert.ok(loaded);
		assert.deepEqual(loaded.legacyPresetEnvelope, {
			kind: 'deliverable',
			transition: transitionPreset.transition
		});
		await userCompositionStore.saveUserComposition('my-transition', loaded);

		// ADR-0068 §3: a Film cannot hold the recipe yet, so the save keeps the Preset shape.
		assert.deepEqual(parsePresetIngress(requestBodyAt(1)), transitionPreset);
	});

	it('uses an explicit request fetch instead of global fetch when loading', async () => {
		const requestFetch = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(jsonResponse(standaloneFilmOf(blankPreset)));

		const loaded = await userCompositionStore.loadUserComposition('request-scoped', requestFetch);

		assert.deepEqual(loaded, documentOf(blankPreset));
		assert.deepEqual(requestFetch.mock.calls[0], ['/api/user-compositions/request-scoped']);
		assert.equal(fetchMock.mock.calls.length, 0);
	});

	it('creates with POST and serializes the Film to its wire format', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ slug: 'blank-copy' }, { status: 201 }));

		await userCompositionStore.createUserComposition(
			'blank-copy',
			documentOf(blankPreset, 'blank')
		);

		const [url, requestInit] = fetchMock.mock.calls[0];
		assert.equal(url, '/api/user-compositions');
		assert.equal(requestInit?.method, 'POST');
		assert.deepEqual(requestInit?.headers, { 'Content-Type': 'application/json' });
		const body = requestBodyAt(0) as {
			slug: unknown;
			film: {
				schema: unknown;
				scenes: { origin: unknown; state: { surface: { content: { body: unknown } } } }[];
			};
		};
		assert.deepEqual(Object.keys(body), ['slug', 'film']);
		assert.equal(body.slug, 'blank-copy');
		assert.equal(body.film.schema, 'gfx-film@1');
		assert.deepEqual(body.film.scenes[0].origin, { slug: 'blank', contentKey: null });
		assert.equal(body.film.scenes[0].state.surface.content.body, '');
	});

	it('maps save and delete to the slug PUT and DELETE routes', async () => {
		fetchMock
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));

		await userCompositionStore.saveUserComposition('blank copy', documentOf(blankPreset));
		await userCompositionStore.deleteUserComposition('blank copy');

		assert.equal(fetchMock.mock.calls[0]?.[0], '/api/user-compositions/blank%20copy');
		assert.equal(fetchMock.mock.calls[0]?.[1]?.method, 'PUT');
		// The PUT body is the standalone Film document, the same one GET returns.
		const saved = requestBodyAt(0) as {
			schema: unknown;
			scenes: { state: { surface: { content: { body: unknown } } } }[];
		};
		assert.equal(saved.schema, 'gfx-film@1');
		assert.equal(saved.scenes[0].state.surface.content.body, '');
		assert.deepEqual(fetchMock.mock.calls[1], [
			'/api/user-compositions/blank%20copy',
			{ method: 'DELETE' }
		]);
	});

	it('names a write under a Starter slug as the typed refusal it is', async () => {
		const refusal = (): Response =>
			jsonResponse(
				{ message: '"blank" is the slug of a Starter this engine ships' },
				{ status: 409 }
			);
		fetchMock.mockResolvedValueOnce(refusal()).mockResolvedValueOnce(refusal());

		for (const write of [
			() => userCompositionStore.createUserComposition('blank', documentOf(blankPreset, 'blank')),
			() => userCompositionStore.saveUserComposition('blank', documentOf(blankPreset, 'blank'))
		]) {
			await assert.rejects(write(), (cause) => {
				assert.ok(isUserCompositionStarterSlugError(cause));
				assert.equal(cause.slug, 'blank');
				return true;
			});
		}
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

	// A delete of a slug this origin never had has to be tellable apart from an
	// origin that would not answer.
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
			jsonResponse({ message: 'Invalid composition: state.surface is required' }, { status: 400 })
		);

		await assert.rejects(
			userCompositionStore.saveUserComposition('blank-copy', documentOf(blankPreset)),
			/Failed to save User composition "blank-copy": 400: Invalid composition: state\.surface is required/
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

	it('preserves canonical media through list, load, create, and save transport', async () => {
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
			.mockResolvedValueOnce(jsonResponse(standaloneFilmOf(preset, 'blank')))
			.mockResolvedValueOnce(jsonResponse({ slug: 'media-copy' }, { status: 201 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));

		assert.deepEqual(await userCompositionStore.listUserCompositions(), [metadata]);
		const loaded = await userCompositionStore.loadUserComposition('media-copy');
		assert.deepEqual(loaded, documentOf(preset, 'blank'));
		assert.ok(loaded);
		await userCompositionStore.createUserComposition('media-copy-2', loaded);
		await userCompositionStore.saveUserComposition('media-copy', loaded);

		const createBody = requestBodyAt(2) as {
			film: { scenes: { state: Record<string, unknown> }[] };
		};
		const saveBody = requestBodyAt(3) as { scenes: { state: Record<string, unknown> }[] };
		for (const scene of [createBody.film.scenes[0], saveBody.scenes[0]]) {
			assert.deepEqual(scene.state.media, preset.state.media);
			assert.equal(Object.hasOwn(scene.state, 'sourceVideo'), false);
		}
	});

	it('preserves a valid chart through load, create, and save and rejects invalid chart loads', async () => {
		const preset = chartPreset();
		const invalidWire = structuredClone(presetToWireFormat(preset)) as Preset;
		invalidWire.state.surface.chart!.items[0].domain = { min: 500, max: 800 };
		const unknownKeyWire = structuredClone(presetToWireFormat(preset)) as unknown as {
			state: { surface: { chart: { items: Array<Record<string, unknown>> } } };
		};
		unknownKeyWire.state.surface.chart.items[0]['literalColor'] = '#ff0000';
		fetchMock
			.mockResolvedValueOnce(jsonResponse(standaloneFilmOf(preset)))
			.mockResolvedValueOnce(jsonResponse({ slug: 'agent-chart-copy' }, { status: 201 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(jsonResponse(invalidWire))
			.mockResolvedValueOnce(jsonResponse(unknownKeyWire));

		const loaded = await userCompositionStore.loadUserComposition('agent-chart');
		assert.ok(loaded);
		assert.deepEqual(loaded.film.scenes[0].state.surface.chart, preset.state.surface.chart);
		await userCompositionStore.createUserComposition('agent-chart-copy', loaded);
		await userCompositionStore.saveUserComposition('agent-chart-copy', loaded);

		const createBody = requestBodyAt(1) as { film: { scenes: { state: Preset['state'] }[] } };
		const saveBody = requestBodyAt(2) as { scenes: { state: Preset['state'] }[] };
		for (const scene of [createBody.film.scenes[0], saveBody.scenes[0]]) {
			assert.deepEqual(scene.state.surface.chart, preset.state.surface.chart);
		}
		await assert.rejects(
			userCompositionStore.loadUserComposition('invalid-chart'),
			/invalid response/
		);
		await assert.rejects(
			userCompositionStore.loadUserComposition('unknown-chart-key'),
			/invalid response/
		);
	});

	it('upgrades a legacy Source video document to a Film with canonical media on the first autosave', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(legacySourceVideoPreset()))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));

		const loaded = await userCompositionStore.loadUserComposition('legacy-source');
		assert.ok(loaded);
		await userCompositionStore.saveUserComposition('legacy-source', loaded);

		const saveBody = requestBodyAt(1) as {
			schema: unknown;
			scenes: { state: Record<string, unknown> }[];
		};
		assert.equal(saveBody.schema, 'gfx-film@1');
		assert.equal(Object.hasOwn(saveBody.scenes[0].state, 'sourceVideo'), false);
		assert.deepEqual(saveBody.scenes[0].state.media, {
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
