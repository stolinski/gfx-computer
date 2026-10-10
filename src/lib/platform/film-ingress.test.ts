import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';
import chapterCardDescentPresetJson from '$lib/presets/chapter-card-descent.json';
import lowerThirdPresetJson from '$lib/presets/lower-third.json';

import { isEngineStateOpaque } from '../utils/output-classification';
import { EngineStateSchema, type Preset } from './engine-schema';
import {
	FILM_FIRST_SCENE_ID,
	FilmIngressSchema,
	filmFromCorpusPreset,
	filmFromPreset,
	filmToWireFormat,
	parseFilm,
	parseFilmIngress,
	presetFromFilmScene,
	presetFromSingleSceneFilm,
	sceneStateForPlayback,
	validateFilmSemantics
} from './film-ingress';
import {
	filmFrameCount,
	filmSceneBoundaryOverlaps,
	resolveFilmBoundaryWindowFrame
} from './film-playhead';
import { FILM_SCHEMA_ID, type Film } from './film-schema';
import { transitionEffectDefinitions } from './pipelines/transition-definition-registry';
import { posterKeyForPreset } from './posters';
import { parsePresetIngress } from './preset-ingress';
import { presetToWireFormat } from './preset-pure';
import { validatePresetSemantics } from './preset-validation';

interface SceneDocumentOptions {
	transport?: Record<string, unknown>;
	state?: Record<string, unknown>;
}

function sceneDocument(id: string, options: SceneDocumentOptions = {}): Record<string, unknown> {
	return {
		id,
		origin: null,
		state: {
			...blankPresetJson.state,
			...options.state,
			transport: options.transport ?? blankPresetJson.state.transport
		}
	};
}

function filmDocument(scenes: readonly Record<string, unknown>[]): Record<string, unknown> {
	return {
		schema: FILM_SCHEMA_ID,
		name: 'Launch film',
		pack: 'syntax',
		orientation: 'vertical',
		fps: 29.97,
		format: 'prores',
		scenes,
		boundaries: scenes.slice(1).map(() => ({ kind: 'cut' }))
	};
}

/** The wire form of a Film made by `filmFromPreset`: its one Scene state as Preset JSON writes it. */
function wireDocumentOfOneSceneFilm(film: Film, preset: Preset): unknown {
	const presetWire = presetToWireFormat(preset) as { state: unknown };
	return { ...film, scenes: [{ ...film.scenes[0], state: presetWire.state }] };
}

describe('Film ingress transport stamping', () => {
	it("writes the Film's orientation, fps, and format over a Scene transport that disagrees", () => {
		const film = parseFilmIngress(
			filmDocument([
				sceneDocument('intro'),
				sceneDocument('outro', {
					transport: { orientation: 'horizontal', durationSeconds: 2.5, fps: 60, format: 'webm' }
				})
			])
		);

		for (const scene of film.scenes) {
			assert.equal(scene.state.transport.orientation, 'vertical');
			assert.equal(scene.state.transport.fps, 29.97);
			assert.equal(scene.state.transport.format, 'prores');
		}
	});

	it("keeps each Scene's own duration and poster frame", () => {
		const film = parseFilmIngress(
			filmDocument([
				sceneDocument('intro', {
					transport: {
						orientation: 'horizontal',
						durationSeconds: 2.5,
						fps: 30,
						format: 'webm',
						posterSeconds: 1.25
					}
				}),
				sceneDocument('outro')
			])
		);

		assert.equal(film.scenes[0].state.transport.durationSeconds, 2.5);
		assert.equal(film.scenes[0].state.transport.posterSeconds, 1.25);
		assert.equal(film.scenes[1].state.transport.durationSeconds, 6);
	});

	it('fills a Scene transport that leaves the shared fields out', () => {
		const film = parseFilmIngress(
			filmDocument([sceneDocument('intro', { transport: { durationSeconds: 4 } })])
		);

		assert.deepEqual(film.scenes[0].state.transport, {
			orientation: 'vertical',
			durationSeconds: 4,
			fps: 29.97,
			format: 'prores'
		});
	});

	it('does not fail on a Scene value the Film overwrites', () => {
		const result = FilmIngressSchema.safeParse(
			filmDocument([
				sceneDocument('intro', {
					transport: { orientation: 'square', durationSeconds: 4, fps: 500, format: 'gif' }
				})
			])
		);

		assert.equal(result.success, true);
	});

	it('leaves every Scene state a complete engine state on its own', () => {
		const film = parseFilmIngress(filmDocument([sceneDocument('intro'), sceneDocument('outro')]));
		const filmWire = wireDocumentOfOneSceneFilm(film, {
			schema: 'gfx@1',
			name: film.name,
			pack: film.pack,
			kind: 'deliverable',
			state: film.scenes[0].state
		}) as { scenes: { state: unknown }[] };

		assert.equal(EngineStateSchema.safeParse(filmWire.scenes[0].state).success, true);
	});

	it('still refuses a Scene transport the Film cannot repair', () => {
		const tooLong = FilmIngressSchema.safeParse(
			filmDocument([sceneDocument('intro', { transport: { durationSeconds: 601 } })])
		);
		const unknownKey = FilmIngressSchema.safeParse(
			filmDocument([sceneDocument('intro', { state: { sceneNotes: 'x' } })])
		);

		assert.equal(tooLong.success, false);
		assert.equal(unknownKey.success, false);
	});

	it('reports a malformed document through FilmSchema instead of throwing', () => {
		for (const document of [null, 'film', 12, [], {}, { scenes: 'intro' }, { scenes: [null, 4] }]) {
			assert.equal(FilmIngressSchema.safeParse(document).success, false);
		}
	});
});

describe('filmFromPreset', () => {
	const corpusPresets: readonly { slug: string; json: unknown; isOpaque: boolean }[] = [
		{ slug: 'lower-third', json: lowerThirdPresetJson, isOpaque: false },
		{ slug: 'chapter-card-descent', json: chapterCardDescentPresetJson, isOpaque: true }
	];

	for (const { slug, json, isOpaque } of corpusPresets) {
		it(`makes a one-Scene Film that plays the ${slug} Preset's own state`, () => {
			const preset = parsePresetIngress(json);
			const origin = { slug, contentKey: posterKeyForPreset(preset) };

			const film = filmFromPreset(preset, origin);

			assert.equal(film.schema, 'gfx-film@1');
			assert.equal(film.name, preset.name);
			assert.equal(film.description, preset.description);
			assert.equal(film.pack, preset.pack);
			assert.equal(film.orientation, preset.state.transport.orientation);
			assert.equal(film.fps, preset.state.transport.fps);
			assert.equal(film.format, preset.state.transport.format);
			assert.deepEqual(film.boundaries, []);
			assert.equal(film.scenes.length, 1);
			assert.equal(film.scenes[0].id, FILM_FIRST_SCENE_ID);
			assert.deepEqual(film.scenes[0].origin, origin);
			assert.equal('kind' in film, false);
			assert.equal('transition' in film, false);

			const playbackState = sceneStateForPlayback(film, FILM_FIRST_SCENE_ID);
			assert.deepEqual(playbackState, preset.state);
			assert.equal(isEngineStateOpaque(playbackState), isOpaque);
			assert.equal(playbackState.backgroundFill !== undefined, isOpaque);
		});

		it(`round-trips the ${slug} Film through its wire form`, () => {
			const preset = parsePresetIngress(json);
			const film = filmFromPreset(preset, { slug, contentKey: posterKeyForPreset(preset) });

			const reparsed = parseFilmIngress(
				JSON.parse(JSON.stringify(wireDocumentOfOneSceneFilm(film, preset)))
			);

			assert.deepEqual(reparsed, film);
			// The Scene still has the content key of the Preset it came from.
			assert.equal(
				posterKeyForPreset({ ...preset, state: reparsed.scenes[0].state }),
				film.scenes[0].origin?.contentKey
			);
		});

		it(`finds in the ${slug} Film what Preset validation finds in the Preset`, () => {
			const preset = parsePresetIngress(json);

			assert.deepEqual(validatePresetSemantics(preset), []);
			assert.deepEqual(validateFilmSemantics(filmFromPreset(preset, null)), []);
		});
	}

	it("gives the Scene its own copy of the Preset's state", () => {
		const preset = parsePresetIngress(lowerThirdPresetJson);
		const origin = { slug: 'lower-third', contentKey: posterKeyForPreset(preset) };
		const film = filmFromPreset(preset, origin);

		film.scenes[0].state.transport.durationSeconds = 99;
		origin.slug = 'changed';

		assert.equal(preset.state.transport.durationSeconds, 6.7);
		assert.equal(film.scenes[0].origin?.slug, 'lower-third');
	});

	it('records no origin for a Scene that did not come from a catalogue Preset', () => {
		const film = filmFromPreset(parsePresetIngress(blankPresetJson), null);

		assert.equal(film.scenes[0].origin, null);
		assert.equal('description' in film, false);
	});
});

describe('filmFromCorpusPreset', () => {
	it('names the Scene for the Preset and changes nothing else of filmFromPreset', () => {
		const preset = parsePresetIngress(lowerThirdPresetJson);
		const origin = { slug: 'lower-third', contentKey: posterKeyForPreset(preset) };

		const film = filmFromCorpusPreset(preset, origin);
		const unnamed = filmFromPreset(preset, origin);

		assert.equal(film.scenes[0].name, preset.name);
		assert.equal('name' in unnamed.scenes[0], false);
		assert.deepEqual({ ...film, scenes: [] }, { ...unnamed, scenes: [] });
		assert.deepEqual(film.scenes[0].origin, origin);
		assert.deepEqual(film.scenes[0].state, unnamed.scenes[0].state);
		// The name survives the wire format and the ingress boundary.
		assert.equal(parseFilmIngress(filmToWireFormat(film)).scenes[0].name, preset.name);
	});
});

describe('filmToWireFormat', () => {
	it('is stable through parse, wire, and parse again', () => {
		const preset = parsePresetIngress(lowerThirdPresetJson);
		const film = parseFilm({
			...filmDocument([
				{
					id: 'intro',
					origin: { slug: 'lower-third', contentKey: null },
					state: (presetToWireFormat(preset) as { state: unknown }).state
				},
				sceneDocument('outro')
			]),
			pack: preset.pack
		});
		// The fixture is only worth its name if there is a parsed body to serialize.
		assert.notEqual(typeof film.scenes[0].state.surface.content.body, 'string');

		const wire: unknown = JSON.parse(JSON.stringify(filmToWireFormat(film)));
		const reparsed = parseFilm(wire);

		assert.deepEqual(reparsed, film);
		assert.deepEqual(JSON.parse(JSON.stringify(filmToWireFormat(reparsed))), wire);
	});

	it("writes each Scene's state exactly as presetToWireFormat writes a Preset's", () => {
		const preset = parsePresetIngress(lowerThirdPresetJson);
		const film = filmFromPreset(preset, null);

		assert.deepEqual(filmToWireFormat(film), wireDocumentOfOneSceneFilm(film, preset));
	});

	it("writes the Film's transport over a Scene edited out of step in memory", () => {
		const film = parseFilmIngress(filmDocument([sceneDocument('intro')]));
		film.fps = 60;

		const wire = filmToWireFormat(film) as { scenes: { state: { transport: { fps: number } } }[] };

		assert.equal(wire.scenes[0]?.state.transport.fps, 60);
		assert.equal(film.scenes[0].state.transport.fps, 29.97);
	});
});

describe('parseFilm', () => {
	it('throws one error naming every schema finding with its path', () => {
		assert.throws(
			() => parseFilm({ ...filmDocument([sceneDocument('intro')]), name: '', boundaries: [{}] }),
			(cause) => {
				assert.ok(cause instanceof Error);
				assert.match(cause.message, /^Invalid GFX film:\n/);
				assert.match(cause.message, /name: Film name is required/);
				assert.match(cause.message, /boundaries/);
				return true;
			}
		);
	});

	it('throws on a semantic finding the schema cannot see', () => {
		assert.throws(
			() => parseFilm({ ...filmDocument([sceneDocument('intro')]), pack: 'no-such-pack' }),
			/Invalid GFX film:\npack: /
		);
	});
});

describe('presetFromSingleSceneFilm', () => {
	it('is the inverse of filmFromPreset for a deliverable Preset', () => {
		const preset = parsePresetIngress(lowerThirdPresetJson);
		const film = filmFromPreset(preset, null);

		const restored = presetFromSingleSceneFilm(film);

		assert.deepEqual(restored, preset);
		assert.notEqual(restored.state, film.scenes[0].state);
	});

	it("stamps the Film's transport and names user work a deliverable", () => {
		const film = filmFromPreset(parsePresetIngress(blankPresetJson), null);
		film.orientation = 'vertical';

		const restored = presetFromSingleSceneFilm(film);

		assert.equal(restored.kind, 'deliverable');
		assert.equal(restored.state.transport.orientation, 'vertical');
		assert.equal('description' in restored, false);
	});

	it('refuses a Film of more than one Scene, which is not one Preset', () => {
		const film = parseFilmIngress(filmDocument([sceneDocument('intro'), sceneDocument('outro')]));

		assert.throws(
			() => presetFromSingleSceneFilm(film),
			(cause) =>
				cause instanceof RangeError && /has 2 Scenes, so it is not one Preset/.test(cause.message)
		);
	});
});

describe('presetFromFilmScene', () => {
	it("makes each Scene of a longer Film the Preset it would be alone, under the Film's transport", () => {
		const film = parseFilmIngress(filmDocument([sceneDocument('intro'), sceneDocument('outro')]));
		film.orientation = 'vertical';

		const outro = presetFromFilmScene(film, 'outro');

		assert.equal(outro.name, film.name);
		assert.equal(outro.pack, film.pack);
		assert.equal(outro.kind, 'deliverable');
		assert.equal(outro.state.transport.orientation, 'vertical');
		assert.deepEqual(outro.state, sceneStateForPlayback(film, 'outro'));
		assert.notEqual(outro.state, film.scenes[1].state);
	});

	it('refuses a Scene the Film does not hold', () => {
		const film = parseFilmIngress(filmDocument([sceneDocument('intro')]));

		assert.throws(() => presetFromFilmScene(film, 'missing'), RangeError);
	});
});

describe('sceneStateForPlayback', () => {
	it("applies the Film's transport even after the Film changed in memory", () => {
		const film = parseFilmIngress(
			filmDocument([
				sceneDocument('intro'),
				sceneDocument('outro', { transport: { durationSeconds: 3 } })
			])
		);
		film.orientation = 'horizontal';
		film.fps = 60;
		film.format = 'webm';

		assert.deepEqual(sceneStateForPlayback(film, 'outro').transport, {
			orientation: 'horizontal',
			durationSeconds: 3,
			fps: 60,
			format: 'webm'
		});
		// The Scene the Film holds is not rewritten by reading it.
		assert.equal(film.scenes[1].state.transport.fps, 29.97);
	});

	it('throws for a Scene the Film does not have', () => {
		const film = parseFilmIngress(filmDocument([sceneDocument('intro')]));

		assert.throws(() => sceneStateForPlayback(film, 'outro'), RangeError);
	});
});

describe('validateFilmSemantics', () => {
	it('finds nothing wrong with a valid three-Scene Film', () => {
		const film = parseFilmIngress(
			filmDocument([sceneDocument('intro'), sceneDocument('proof'), sceneDocument('outro')])
		);

		assert.deepEqual(validateFilmSemantics(film), []);
	});

	it('reports duplicate Scene ids and a wrong boundary count on a Film edited in memory', () => {
		const film = parseFilmIngress(
			filmDocument([sceneDocument('intro'), sceneDocument('proof'), sceneDocument('outro')])
		);
		film.scenes[2].id = 'intro';
		film.boundaries = [{ kind: 'cut' }];

		assert.deepEqual(
			validateFilmSemantics(film).map((issue) => issue.path),
			[['scenes', 2, 'id'], ['boundaries']]
		);
	});

	it("reports a Scene's Preset finding under that Scene's index", () => {
		const film = parseFilmIngress(
			filmDocument([
				sceneDocument('intro'),
				sceneDocument('proof', {
					state: {
						media: {
							assets: [],
							videoTrack: {
								clips: [
									{
										id: 'clip-1',
										assetId: 'missing-asset',
										timelineStartFrame: 0,
										durationFrames: 10,
										sourceStartSeconds: 0,
										audio: { enabled: true, gain: 1 }
									}
								]
							}
						}
					}
				})
			])
		);

		assert.deepEqual(validateFilmSemantics(film), [
			{
				path: ['scenes', 1, 'state', 'media', 'videoTrack', 'clips', 0, 'assetId'],
				message: 'Video clip "clip-1" references missing asset "missing-asset"'
			}
		]);
	});

	it('reports an unknown Pack once, at the Film, however many Scenes there are', () => {
		const film = parseFilmIngress({
			...filmDocument([sceneDocument('intro'), sceneDocument('proof'), sceneDocument('outro')]),
			pack: 'not-a-registered-pack'
		});

		const issues = validateFilmSemantics(film);

		assert.equal(issues.length, 1);
		assert.deepEqual(issues[0].path, ['pack']);
		assert.match(issues[0].message, /Unknown Pack "not-a-registered-pack"/);
		assert.deepEqual(validateFilmSemantics(film, { packScope: 'stored' }), []);
	});

	it('holds the whole Film to the duration ceiling of one composition', () => {
		const sceneOfSeconds = (id: string, durationSeconds: number): Record<string, unknown> =>
			sceneDocument(id, { transport: { durationSeconds } });
		const atCeiling = parseFilmIngress(
			filmDocument([sceneOfSeconds('intro', 300), sceneOfSeconds('outro', 300)])
		);
		const overCeiling = parseFilmIngress(
			filmDocument([
				sceneOfSeconds('intro', 300),
				sceneOfSeconds('proof', 300),
				sceneOfSeconds('outro', 0.1)
			])
		);

		assert.deepEqual(validateFilmSemantics(atCeiling), []);
		// 600 s at 30000/1001 is 17982 frames; the third Scene adds 3 more.
		assert.deepEqual(validateFilmSemantics(overCeiling), [
			{
				path: ['scenes'],
				message:
					'The Film runs 17985 frames, beyond the 17982 frames of the 600-second ceiling at 29.97 fps. Shorten or remove a Scene.'
			}
		]);
	});

	describe('the bounds of a fade', () => {
		const sceneOfSeconds = (id: string, durationSeconds: number): Record<string, unknown> =>
			sceneDocument(id, { transport: { durationSeconds } });

		/** Scenes of the given lengths at 30 fps, with the given boundaries. */
		function filmWithBoundaries(
			durationsSeconds: readonly number[],
			boundaries: readonly unknown[],
			fps = 30
		): Film {
			return parseFilmIngress({
				...filmDocument(
					durationsSeconds.map((seconds, index) => sceneOfSeconds(`scene-${index + 1}`, seconds))
				),
				fps,
				boundaries
			});
		}

		it('finds nothing wrong with a fade its Scenes have room for', () => {
			assert.deepEqual(
				validateFilmSemantics(filmWithBoundaries([2, 3], [{ kind: 'fade', durationMs: 1000 }])),
				[]
			);
			// As long as the shorter Scene, exactly: the whole Scene is in the window.
			assert.deepEqual(
				validateFilmSemantics(filmWithBoundaries([2, 3], [{ kind: 'fade', durationMs: 2000 }])),
				[]
			);
			// One frame.
			assert.deepEqual(
				validateFilmSemantics(filmWithBoundaries([2, 3], [{ kind: 'fade', durationMs: 33 }])),
				[]
			);
		});

		it('reports a fade shorter than one frame at the Film rate, at its durationMs', () => {
			const film = filmWithBoundaries([2, 3], [{ kind: 'fade', durationMs: 16 }]);

			assert.deepEqual(validateFilmSemantics(film), [
				{
					path: ['boundaries', 0, 'durationMs'],
					message:
						'The fade between Scene "scene-1" and Scene "scene-2" lasts 16 ms, less than one frame at 30 fps. Lengthen it, or make the boundary a cut.'
				}
			]);
			// The same 16 ms is a whole frame at 60 fps.
			assert.deepEqual(
				validateFilmSemantics(filmWithBoundaries([2, 3], [{ kind: 'fade', durationMs: 16 }], 60)),
				[]
			);
		});

		it('reports a fade longer than the shorter of its two Scenes, at its durationMs', () => {
			const film = filmWithBoundaries([2, 1], [{ kind: 'fade', durationMs: 1500 }]);

			assert.deepEqual(validateFilmSemantics(film), [
				{
					path: ['boundaries', 0, 'durationMs'],
					message:
						'The fade between Scene "scene-1" and Scene "scene-2" lasts 45 frames, longer than the shorter of the two Scenes (30 frames). Shorten it.'
				}
			]);
		});

		it('reports two fades that would meet inside the Scene between them, at the second', () => {
			// The middle Scene is 60 frames; 40 + 30 frames of fade do not fit in it.
			const film = filmWithBoundaries(
				[3, 2, 3],
				[
					{ kind: 'fade', durationMs: 1333.4 },
					{ kind: 'fade', durationMs: 1000 }
				]
			);

			const issues = validateFilmSemantics(film);

			assert.deepEqual(
				issues.map((issue) => issue.path),
				[['boundaries', 1, 'durationMs']]
			);
			assert.match(issues[0].message, /Scene "scene-2" runs 60 frames/);
			assert.match(issues[0].message, /overlap 40 and 30 of them/);
			// 30 + 30 frames fit exactly.
			assert.deepEqual(
				validateFilmSemantics(
					filmWithBoundaries(
						[3, 2, 3],
						[
							{ kind: 'fade', durationMs: 1000 },
							{ kind: 'fade', durationMs: 1000 }
						]
					)
				),
				[]
			);
		});

		it('refuses an out-of-bounds fade when a Film is parsed', () => {
			const document = {
				...filmDocument([sceneOfSeconds('intro', 2), sceneOfSeconds('outro', 1)]),
				fps: 30,
				boundaries: [{ kind: 'fade', durationMs: 1500 }]
			};

			assert.throws(
				() => parseFilm(document),
				/boundaries\.0\.durationMs|boundaries\/0\/durationMs/
			);
		});

		it('keeps a fade through wire and parse again', () => {
			const film = filmWithBoundaries([2, 3], [{ kind: 'fade', durationMs: 1000 }]);

			assert.deepEqual(parseFilm(filmToWireFormat(film)), film);
		});

		describe.each(transitionEffectDefinitions())(
			'and of the $type effect, which are the same',
			(definition) => {
				const effect = (durationMs: number): Record<string, unknown> => ({
					kind: definition.type,
					durationMs,
					params: definition.defaults().params
				});

				it('finds nothing wrong with a window its Scenes have room for', () => {
					for (const durationMs of [1000, 2000, 33]) {
						assert.deepEqual(
							validateFilmSemantics(filmWithBoundaries([2, 3], [effect(durationMs)])),
							[]
						);
					}
				});

				it('reports a window shorter than one frame, at its durationMs', () => {
					assert.deepEqual(validateFilmSemantics(filmWithBoundaries([2, 3], [effect(16)])), [
						{
							path: ['boundaries', 0, 'durationMs'],
							message: `The ${definition.type} between Scene "scene-1" and Scene "scene-2" lasts 16 ms, less than one frame at 30 fps. Lengthen it, or make the boundary a cut.`
						}
					]);
				});

				it('reports a window longer than the shorter of its two Scenes, at its durationMs', () => {
					assert.deepEqual(validateFilmSemantics(filmWithBoundaries([2, 1], [effect(1500)])), [
						{
							path: ['boundaries', 0, 'durationMs'],
							message: `The ${definition.type} between Scene "scene-1" and Scene "scene-2" lasts 45 frames, longer than the shorter of the two Scenes (30 frames). Shorten it.`
						}
					]);
				});

				it('reports a window that would meet a fade inside the Scene between them', () => {
					const issues = validateFilmSemantics(
						filmWithBoundaries([3, 2, 3], [{ kind: 'fade', durationMs: 1333.4 }, effect(1000)])
					);

					assert.deepEqual(
						issues.map((issue) => issue.path),
						[['boundaries', 1, 'durationMs']]
					);
					assert.match(issues[0].message, /overlap 40 and 30 of them/);
					assert.deepEqual(
						validateFilmSemantics(
							filmWithBoundaries([3, 2, 3], [effect(1000), { kind: 'fade', durationMs: 1000 }])
						),
						[]
					);
				});

				it('overlaps its Scenes by its window, as a fade of the same length does', () => {
					const withEffect = filmWithBoundaries([2, 3], [effect(1000)]);
					const withFade = filmWithBoundaries([2, 3], [{ kind: 'fade', durationMs: 1000 }]);

					assert.deepEqual(filmSceneBoundaryOverlaps(withEffect), [30]);
					assert.equal(filmFrameCount(withEffect), filmFrameCount(withFade));
					assert.deepEqual(
						resolveFilmBoundaryWindowFrame(withEffect, 45),
						resolveFilmBoundaryWindowFrame(withFade, 45)
					);
				});

				it('keeps its params through wire and parse again', () => {
					const film = filmWithBoundaries([2, 3], [effect(1000)]);

					assert.deepEqual(parseFilm(filmToWireFormat(film)), film);
				});
			}
		);
	});
});
