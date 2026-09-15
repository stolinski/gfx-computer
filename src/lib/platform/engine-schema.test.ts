import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { BlockTypeSchema, EngineStateSchema, StageSchema } from './engine-schema.ts';

// Minimal valid EngineState input (wire form — `body` is the bracket-tag
// string the schema transforms). Each test mutates a structuredClone of this.
// Typed loosely on purpose: tests author arbitrary (including invalid) wire
// shapes and hand them to safeParse, which owns the narrowing.
interface WireState {
	[key: string]: unknown;
	surface: Record<string, unknown>;
	marks: Record<string, unknown>;
	textAnimations: unknown[];
	overlays: unknown[];
}

const BASE_STATE: WireState = {
	transport: { orientation: 'horizontal', durationSeconds: 6, fps: 30, format: 'webm' },
	typography: { fontFamily: 'serif', paperColor: '#ffffff', inkColor: '#000000' },
	marks: { defaults: {}, timings: [] },
	surface: { type: 'paper', content: { body: 'Hello world.' } },
	textAnimations: [],
	overlays: [],
	effects: [],
	audioCues: []
};

function baseState(): WireState {
	return structuredClone(BASE_STATE);
}

function baseOverlay(id: string): Record<string, unknown> {
	return {
		type: 'lower-third',
		id,
		content: { kicker: 'K', title: 'T' },
		position: { anchor: 'bottom-left', offset: { x: 0.0625, y: 0.0625 } }
	};
}

function videoMedia(extension = 'mp4'): Record<string, unknown> {
	return {
		assets: [
			{
				id: 'video-asset',
				kind: 'video',
				name: 'Interview angle',
				assetUrl: `/api/user-assets/${'a'.repeat(64)}.${extension}`
			}
		],
		videoTrack: {
			clips: [
				{
					id: 'video-clip',
					assetId: 'video-asset',
					timelineStartFrame: 0,
					durationFrames: 180,
					sourceStartSeconds: 18.25,
					audio: { enabled: true, gain: 0.8 }
				}
			]
		}
	};
}

function expectValid(state: unknown, label: string): void {
	const result = EngineStateSchema.safeParse(state);
	assert.ok(
		result.success,
		`${label}: expected valid, got issues:\n${result.success ? '' : result.error.message}`
	);
}

function expectIssue(state: unknown, messageFragment: string, label: string): void {
	const result = EngineStateSchema.safeParse(state);
	assert.ok(!result.success, `${label}: expected a parse failure, but it passed`);
	const messages = result.error.issues.map((issue) => issue.message);
	assert.ok(
		messages.some((message) => message.includes(messageFragment)),
		`${label}: no issue message contains "${messageFragment}". Got:\n${messages.join('\n')}`
	);
}

describe('engine schema', () => {
	it('validates keyframes, rotation, and cascade references', () => {
		// ── Keyframe tracks ────────────────────────────────────────────────────────

		{
			// A multi-step overlay channel set parses and retains its values.
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('main'),
					animation: {
						channels: {
							opacity: [
								{ atMs: 0, value: 0 },
								{ atMs: 300, value: 1, ease: 'smooth' }
							],
							scale: [
								{ atMs: 0, value: 1 },
								{ atMs: 180, value: 0.96, ease: 'sharp' },
								{ atMs: 420, value: 1, ease: 'settled' }
							],
							y: [
								{ atMs: 0, value: 0.04 },
								{ atMs: 300, value: 0, ease: 'smooth' }
							]
						}
					}
				}
			];
			const result = EngineStateSchema.safeParse(state);
			assert.ok(
				result.success,
				`multi-channel overlay keyframes: ${result.success ? '' : result.error.message}`
			);
			const channels = result.data.overlays[0].animation?.channels;
			assert.equal(channels?.scale?.length, 3);
			assert.equal(channels?.scale?.[1].value, 0.96);
			assert.equal(channels?.scale?.[1].ease, 'sharp');
		}

		{
			// First keyframe must not carry an ease — ease is the curve INTO a keyframe.
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('main'),
					animation: { channels: { opacity: [{ atMs: 0, value: 0, ease: 'smooth' }] } }
				}
			];
			expectIssue(state, 'first keyframe', 'first-keyframe ease');
		}

		{
			// atMs must be strictly ascending.
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('main'),
					animation: {
						channels: {
							opacity: [
								{ atMs: 300, value: 0 },
								{ atMs: 300, value: 1, ease: 'smooth' }
							]
						}
					}
				}
			];
			expectIssue(state, 'strictly ascending', 'non-ascending atMs');
		}

		{
			// A declared channel needs at least one keyframe.
			const state = baseState();
			state.overlays = [{ ...baseOverlay('main'), animation: { channels: { opacity: [] } } }];
			expectIssue(state, 'at least one keyframe', 'empty track');
		}

		{
			// Opacity keyframe values are 0..1 fractions.
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('main'),
					animation: {
						channels: {
							opacity: [
								{ atMs: 0, value: 0 },
								{ atMs: 300, value: 1.5, ease: 'smooth' }
							]
						}
					}
				}
			];
			const result = EngineStateSchema.safeParse(state);
			assert.ok(!result.success, 'opacity value out of range: expected failure');
		}

		{
			// Scale keyframe values share the static field's 0.1..8 bounds.
			const state = baseState();
			state.overlays = [
				{ ...baseOverlay('main'), animation: { channels: { scale: [{ atMs: 0, value: 9 }] } } }
			];
			const result = EngineStateSchema.safeParse(state);
			assert.ok(!result.success, 'scale value out of range: expected failure');
		}

		{
			// x/y are signed deltas — negative values are legal (slide in from offscreen).
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('main'),
					animation: {
						channels: {
							x: [
								{ atMs: 0, value: -0.2 },
								{ atMs: 300, value: 0, ease: 'smooth' }
							]
						}
					}
				}
			];
			expectValid(state, 'negative x delta');
		}

		{
			// Surface channels are opacity-only; a transform channel fails loudly
			// (strict object) instead of being silently stripped.
			const state = baseState();
			state.surface.animation = {
				channels: {
					opacity: [
						{ atMs: 0, value: 0 },
						{ atMs: 300, value: 1, ease: 'smooth' }
					]
				}
			};
			expectValid(state, 'surface opacity channel');

			const bad = baseState();
			bad.surface.animation = {
				channels: { x: [{ atMs: 0, value: 0 }] }
			};
			const result = EngineStateSchema.safeParse(bad);
			assert.ok(!result.success, 'surface transform channel: expected failure');
		}

		{
			// enter/exit sugar stays valid alongside declared channels — ownership
			// precedence is the manifest builder's call, not a parse error.
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('main'),
					enter: { start: 0.05, duration: 0.05, ease: 'smooth' },
					exit: { start: 0.9, duration: 0.04, ease: 'smooth' },
					animation: {
						channels: {
							opacity: [
								{ atMs: 0, value: 0 },
								{ atMs: 300, value: 1, ease: 'smooth' }
							]
						}
					}
				}
			];
			expectValid(state, 'enter/exit sugar coexists with channels');
		}

		// ── Static position rotation ───────────────────────────────────────────────

		{
			const state = baseState();
			const overlay = baseOverlay('main');
			(overlay.position as Record<string, unknown>).rotation = -4.5;
			state.overlays = [overlay];
			expectValid(state, 'static rotation');

			const bad = baseState();
			const badOverlay = baseOverlay('main');
			(badOverlay.position as Record<string, unknown>).rotation = 400;
			bad.overlays = [badOverlay];
			const result = EngineStateSchema.safeParse(bad);
			assert.ok(!result.success, 'rotation beyond ±360: expected failure');
		}

		{
			const state = baseState();
			const overlay = baseOverlay('responsive');
			(overlay.position as Record<string, unknown>).orientationOverrides = {
				vertical: {
					anchor: 'bottom-center',
					offset: { x: 0, y: 0.2 },
					scale: 0.9,
					rotation: 2
				}
			};
			state.overlays = [overlay];
			const result = EngineStateSchema.safeParse(state);
			assert.ok(result.success, result.success ? '' : result.error.message);
			assert.deepEqual(result.data.overlays[0].position.orientationOverrides?.vertical, {
				anchor: 'bottom-center',
				offset: { x: 0, y: 0.2 },
				scale: 0.9,
				rotation: 2
			});

			const incomplete = baseState();
			const incompleteOverlay = baseOverlay('responsive');
			(incompleteOverlay.position as Record<string, unknown>).orientationOverrides = {
				vertical: { offset: { x: 0, y: 0.2 } }
			};
			incomplete.overlays = [incompleteOverlay];
			expectIssue(incomplete, 'expected', 'orientation override requires a complete placement');
		}

		{
			const state = baseState();
			state.surface.diagram = [
				{
					type: 'node',
					id: 'source',
					position: { x: 0.2, y: 0.5 },
					form: 'box',
					orientationOverrides: {
						vertical: { position: { x: 0.5, y: 0.25 }, scale: 1.2 }
					}
				},
				{
					type: 'edge-arrow',
					id: 'path',
					from: { node: 'source' },
					to: { x: 0.8, y: 0.5 },
					route: 'straight',
					orientationOverrides: {
						vertical: {
							from: { node: 'source' },
							to: { x: 0.5, y: 0.75 },
							route: 'arc',
							control: { x: 0.7, y: 0.5 }
						}
					}
				}
			];
			expectValid(state, 'diagram orientation geometry snapshots');

			const incomplete = structuredClone(state);
			const node = (incomplete.surface.diagram as Record<string, unknown>[])[0];
			node.orientationOverrides = { vertical: { scale: 1.2 } };
			expectIssue(incomplete, 'expected', 'diagram override requires complete position geometry');

			const badReference = structuredClone(state);
			const edge = (badReference.surface.diagram as Record<string, unknown>[])[1];
			edge.orientationOverrides = {
				vertical: {
					from: { node: 'missing' },
					to: { x: 0.5, y: 0.75 },
					route: 'straight'
				}
			};
			expectIssue(
				badReference,
				'which is not a node primitive',
				'diagram override validates node references'
			);
		}

		// ── Cascade refs ───────────────────────────────────────────────────────────

		{
			// Overlay anchored to the surface's enter end.
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('main'),
					animation: { cascade: { anchor: 'surface', event: 'end', offsetMs: 120 } }
				}
			];
			expectValid(state, 'cascade to surface');
		}

		{
			// Chain: mark → overlay → surface; text animation → overlay. All resolve.
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('title'),
					animation: { cascade: { anchor: 'surface', event: 'end', offsetMs: 120 } }
				}
			];
			state.marks = {
				defaults: {},
				timings: [
					{
						start: 0.34,
						duration: 0.24,
						ease: 'smooth',
						cascade: { anchor: { overlay: 'title' }, event: 'end', offsetMs: 150 }
					}
				]
			};
			state.textAnimations = [
				{
					id: 'title-reveal',
					target: { kind: 'surface', slot: 'title' },
					effect: 'soft-blur-in',
					enter: { start: 0.04, duration: 0.1, ease: 'smooth' },
					cascade: { anchor: { overlay: 'title' }, event: 'start', offsetMs: -60 }
				}
			];
			expectValid(state, 'cascade chain across element kinds');
		}

		{
			// Unknown overlay ref.
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('main'),
					animation: { cascade: { anchor: { overlay: 'ghost' }, event: 'start', offsetMs: 0 } }
				}
			];
			expectIssue(state, 'does not match any overlays[].id', 'unknown overlay anchor');
		}

		{
			// Mark index out of range.
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('main'),
					animation: { cascade: { anchor: { mark: 2 }, event: 'start', offsetMs: 0 } }
				}
			];
			expectIssue(state, 'out of range', 'mark anchor out of range');
		}

		{
			// Unknown text-animation ref.
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('main'),
					animation: {
						cascade: { anchor: { textAnimation: 'ghost' }, event: 'start', offsetMs: 0 }
					}
				}
			];
			expectIssue(state, 'does not match any textAnimations[].id', 'unknown textAnimation anchor');
		}

		// ── Cascade cycles ─────────────────────────────────────────────────────────

		{
			// Two overlays anchored to each other.
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('a'),
					animation: { cascade: { anchor: { overlay: 'b' }, event: 'end', offsetMs: 100 } }
				},
				{
					...baseOverlay('b'),
					animation: { cascade: { anchor: { overlay: 'a' }, event: 'end', offsetMs: 100 } }
				}
			];
			expectIssue(state, 'Cascade cycle', 'two-node cycle');
		}

		{
			// Self-anchor is the one-node cycle.
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('a'),
					animation: { cascade: { anchor: { overlay: 'a' }, event: 'end', offsetMs: 100 } }
				}
			];
			expectIssue(state, 'Cascade cycle', 'self-anchor cycle');
		}

		{
			// A tail leading into a cycle reports the cycle, and an acyclic chain off
			// the same graph still parses on its own.
			const state = baseState();
			state.overlays = [
				{
					...baseOverlay('a'),
					animation: { cascade: { anchor: { overlay: 'b' }, event: 'start', offsetMs: 0 } }
				},
				{
					...baseOverlay('b'),
					animation: { cascade: { anchor: { overlay: 'c' }, event: 'start', offsetMs: 0 } }
				},
				{
					...baseOverlay('c'),
					animation: { cascade: { anchor: { overlay: 'b' }, event: 'start', offsetMs: 0 } }
				}
			];
			const result = EngineStateSchema.safeParse(state);
			assert.ok(!result.success, 'tail into cycle: expected failure');
			const cycleIssues = result.success
				? []
				: result.error.issues.filter((issue) => issue.message.includes('Cascade cycle'));
			assert.equal(cycleIssues.length, 1, 'the b↔c cycle reports exactly once');
			assert.ok(
				cycleIssues[0].message.includes('overlay:b') &&
					cycleIssues[0].message.includes('overlay:c'),
				`cycle message names the loop: ${cycleIssues[0].message}`
			);
		}
	});

	it('keeps Diagram label role optional without materializing a schema default', () => {
		const state = baseState();
		state.surface.diagram = [
			{
				type: 'label',
				id: 'headline',
				position: { x: 0.5, y: 0.2 },
				text: 'Headline',
				role: 'headline'
			},
			{
				type: 'label',
				id: 'legacy-caption',
				position: { x: 0.5, y: 0.4 },
				text: 'Caption'
			}
		];

		const result = EngineStateSchema.safeParse(state);
		assert.ok(result.success, result.success ? '' : result.error.message);
		const diagram = result.data.surface.diagram ?? [];
		assert.equal(diagram[0].type === 'label' ? diagram[0].role : undefined, 'headline');
		assert.equal(diagram[1].type === 'label' ? diagram[1].role : undefined, undefined);

		const invalid = structuredClone(state);
		(invalid.surface.diagram as Record<string, unknown>[])[0].role = 'display';
		expectIssue(invalid, 'Invalid option', 'invalid Diagram label role');
	});

	it('validates canonical Video media and full-frame bed eligibility', () => {
		const emptyResult = EngineStateSchema.safeParse(baseState());
		assert.ok(emptyResult.success, emptyResult.success ? '' : emptyResult.error.message);
		assert.deepEqual(emptyResult.data.media, { assets: [], videoTrack: { clips: [] } });

		const state = baseState();
		state.media = videoMedia();
		state.audioCues = [
			{
				id: 'music',
				kind: 'bed',
				assetSlug: 'bed-warm-keys',
				start: 0,
				duration: 1
			}
		];

		const result = EngineStateSchema.safeParse(state);
		assert.ok(result.success, result.success ? '' : result.error.message);
		assert.deepEqual(result.data.media, state.media);

		const gappedBed = structuredClone(state);
		(
			((gappedBed.media as Record<string, unknown>).videoTrack as Record<string, unknown>)
				.clips as Record<string, unknown>[]
		)[0].timelineStartFrame = 1;
		expectIssue(gappedBed, 'complete Video-track coverage', 'bed with a Video-track gap');

		const stagedBed = baseState();
		stagedBed.stage = {
			type: 'depth',
			camera: {},
			focus: {}
		};
		stagedBed.audioCues = structuredClone(state.audioCues);
		expectValid(stagedBed, 'bed with a dimensional stage');

		for (const extension of ['mov', 'webm']) {
			const alternate = baseState();
			alternate.media = videoMedia(extension);
			expectValid(alternate, `${extension} Video asset`);
		}

		const invalidUrl = baseState();
		invalidUrl.media = videoMedia();
		(
			(invalidUrl.media as Record<string, unknown>).assets as Record<string, unknown>[]
		)[0].assetUrl = '/tmp/source.mp4';
		expectIssue(invalidUrl, 'content-addressed', 'Video asset URL');

		const invalidDuration = baseState();
		invalidDuration.media = videoMedia();
		(
			((invalidDuration.media as Record<string, unknown>).videoTrack as Record<string, unknown>)
				.clips as Record<string, unknown>[]
		)[0].durationFrames = 1.5;
		expectIssue(invalidDuration, 'expected int', 'Video clip duration');

		const invalidGain = baseState();
		invalidGain.media = videoMedia();
		(
			(
				((invalidGain.media as Record<string, unknown>).videoTrack as Record<string, unknown>)
					.clips as Record<string, unknown>[]
			)[0].audio as Record<string, unknown>
		).gain = 4.1;
		expectIssue(invalidGain, '<=4', 'Video clip gain');

		const volatileMetadata = baseState();
		volatileMetadata.media = videoMedia();
		(
			(volatileMetadata.media as Record<string, unknown>).assets as Record<string, unknown>[]
		)[0].probeDurationSeconds = 30;
		expectIssue(volatileMetadata, 'Unrecognized key', 'volatile probe metadata');

		const legacy = baseState();
		legacy.sourceVideo = { assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4` };
		expectIssue(legacy, 'Unrecognized key', 'legacy Source video at canonical boundary');

		const withFill = structuredClone(state);
		withFill.backgroundFill = '#000000';
		expectIssue(withFill, 'cannot be combined with backgroundFill', 'Video clips plus fill');

		// The sentinel is still a PRESENT fill — the Video-clip exclusion binds
		// on presence, not value (ADR-0039 §3 keeps the presence law untouched).
		const withPackFill = structuredClone(state);
		withPackFill.backgroundFill = 'pack';
		expectIssue(
			withPackFill,
			'cannot be combined with backgroundFill',
			'Video clips plus pack fill'
		);

		const withStage = structuredClone(state);
		withStage.stage = {
			type: 'depth',
			camera: { fov: 35, push: 0, driftX: 0, driftY: 0 },
			focus: { focalZ: 0.5, aperture: 0.2, maxBlur: 20 }
		};
		expectIssue(withStage, 'cannot be combined with a dimensional stage', 'Video clips plus stage');
	});
});

describe("backgroundFill 'pack' sentinel (ADR-0039 §3)", () => {
	it('accepts a hex, the pack sentinel, and absence', () => {
		const hex = baseState();
		hex.backgroundFill = '#0e0e0d';
		expectValid(hex, 'hex backgroundFill');

		const sentinel = baseState();
		sentinel.backgroundFill = 'pack';
		expectValid(sentinel, 'pack sentinel backgroundFill');

		expectValid(baseState(), 'absent backgroundFill');
	});

	it('rejects any other keyword — only #rrggbb or the literal "pack"', () => {
		const invalid = baseState();
		invalid.backgroundFill = 'field';
		assert.equal(EngineStateSchema.safeParse(invalid).success, false);
	});
});

function chartWire(
	type: 'bar-chart' | 'column-chart' | 'line-chart' | 'unit-grid-chart' | 'dot-field-chart'
) {
	const common = {
		id: `${type}-a`,
		type,
		title: 'Agent count',
		data: {
			categories: [
				{ id: 'one', label: '1' },
				{ id: 'multiple', label: '2–5' }
			],
			series: [
				{
					id: 'responses',
					label: 'Responses',
					values: [
						{ categoryId: 'one', value: 360 },
						{ categoryId: 'multiple', value: 744 }
					]
				}
			]
		},
		domain: { min: 0, max: 1104 },
		labels: { categories: true, values: true, legend: false },
		highlights: [{ target: { kind: 'datum', seriesId: 'responses', categoryId: 'multiple' } }],
		callouts: [
			{
				target: { kind: 'datum', seriesId: 'responses', categoryId: 'multiple' },
				valueLabel: {
					kind: 'approximate-fraction-and-percent',
					maxDenominator: 10,
					precision: 1
				}
			}
		],
		sourceNote: 'Syntax survey',
		fill: { role: 'default' },
		motion: {
			entry: { start: 0, duration: 0.1, ease: 'smooth' },
			reveal: { start: 0.1, duration: 0.2, ease: 'smooth' },
			emphasis: { start: 0.3, duration: 0.1, ease: 'sharp' },
			annotation: { start: 0.4, duration: 0.1, ease: 'smooth' },
			exit: { start: 0.9, duration: 0.1, ease: 'smooth' }
		}
	};
	if (type === 'bar-chart' || type === 'column-chart') {
		return { ...common, layout: { mode: 'single' } };
	}
	if (type === 'line-chart') return common;
	return { ...common, normalization: { total: 1104, unitCount: 100 } };
}

function stateWithChart(
	type:
		| 'bar-chart'
		| 'column-chart'
		| 'line-chart'
		| 'unit-grid-chart'
		| 'dot-field-chart' = 'bar-chart'
): WireState {
	const state = baseState();
	state.surface['chart'] = { mode: 'single', items: [chartWire(type)] };
	return state;
}

function chartRecordAt(
	state: WireState,
	path: readonly (string | number)[]
): Record<string, unknown> {
	let value: unknown = state.surface['chart'];
	for (const segment of path) {
		if (typeof segment === 'number') {
			if (!Array.isArray(value)) throw new TypeError(`Expected chart array at ${path.join('.')}`);
			value = value[segment];
			continue;
		}
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			throw new TypeError(`Expected chart object at ${path.join('.')}`);
		}
		value = (value as Record<string, unknown>)[segment];
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`Expected chart object at ${path.join('.')}`);
	}
	return value as Record<string, unknown>;
}

describe('chart Block structural schema', () => {
	it('parses all five stable chart Pipeline IDs', () => {
		for (const type of [
			'bar-chart',
			'column-chart',
			'line-chart',
			'unit-grid-chart',
			'dot-field-chart'
		] as const) {
			expectValid(stateWithChart(type), type);
			assert.equal(BlockTypeSchema.safeParse(type).success, true);
		}
	});

	it('rejects unknown keys at every chart object boundary', () => {
		const paths: readonly (readonly (string | number)[])[] = [
			[],
			['items', 0],
			['items', 0, 'data'],
			['items', 0, 'data', 'categories', 0],
			['items', 0, 'data', 'series', 0],
			['items', 0, 'data', 'series', 0, 'values', 0],
			['items', 0, 'highlights', 0],
			['items', 0, 'highlights', 0, 'target'],
			['items', 0, 'callouts', 0],
			['items', 0, 'callouts', 0, 'target'],
			['items', 0, 'callouts', 0, 'valueLabel'],
			['items', 0, 'domain'],
			['items', 0, 'labels'],
			['items', 0, 'fill'],
			['items', 0, 'layout'],
			['items', 0, 'motion'],
			['items', 0, 'motion', 'entry']
		];
		for (const [index, path] of paths.entries()) {
			const state = stateWithChart();
			chartRecordAt(state, path)['unknown'] = true;
			expectIssue(state, 'Unrecognized key', `unknown chart key ${index}`);
		}

		const normalized = stateWithChart('unit-grid-chart');
		chartRecordAt(normalized, ['items', 0, 'normalization'])['unknown'] = true;
		expectIssue(normalized, 'Unrecognized key', 'unknown normalization key');
	});

	it('rejects non-finite values and bounded chart controls', () => {
		const infinite = stateWithChart();
		const infiniteItem = (
			infinite.surface['chart'] as {
				items: Array<{ data: { series: Array<{ values: Array<{ value: number }> }> } }>;
			}
		).items[0];
		infiniteItem.data.series[0].values[0].value = Number.POSITIVE_INFINITY;
		expectIssue(infinite, 'expected number', 'infinite chart value');

		const lowUnits = stateWithChart('unit-grid-chart');
		(
			lowUnits.surface['chart'] as { items: Array<{ normalization: { unitCount: number } }> }
		).items[0].normalization.unitCount = 9;
		expectIssue(lowUnits, 'Too small', 'unitCount lower bound');

		const maximumUnits = stateWithChart('unit-grid-chart');
		(
			maximumUnits.surface['chart'] as { items: Array<{ normalization: { unitCount: number } }> }
		).items[0].normalization.unitCount = 1000;
		expectValid(maximumUnits, 'unitCount upper boundary');

		const highUnits = stateWithChart('dot-field-chart');
		(
			highUnits.surface['chart'] as { items: Array<{ normalization: { unitCount: number } }> }
		).items[0].normalization.unitCount = 1001;
		expectIssue(highUnits, 'Too big', 'unitCount upper bound');

		const highDenominator = stateWithChart();
		(
			highDenominator.surface['chart'] as {
				items: Array<{ callouts: Array<{ valueLabel: { maxDenominator: number } }> }>;
			}
		).items[0].callouts[0].valueLabel.maxDenominator = 21;
		expectIssue(highDenominator, 'Too big', 'fraction denominator upper bound');
	});

	it('bounds chart categories, values, and series before renderer allocation', () => {
		const categories = stateWithChart();
		const categoryData = chartRecordAt(categories, ['items', 0, 'data']);
		categoryData['categories'] = Array.from({ length: 13 }, (_, index) => ({
			id: `category-${index}`,
			label: `Category ${index}`
		}));
		expectIssue(categories, 'Too big', 'chart category upper bound');

		const values = stateWithChart();
		const seriesRecord = chartRecordAt(values, ['items', 0, 'data', 'series', 0]);
		seriesRecord['values'] = Array.from({ length: 13 }, (_, index) => ({
			categoryId: `category-${index}`,
			value: index
		}));
		expectIssue(values, 'Too big', 'chart value upper bound');

		const series = stateWithChart();
		const seriesData = chartRecordAt(series, ['items', 0, 'data']);
		const firstSeries = (seriesData['series'] as unknown[])[0];
		seriesData['series'] = Array.from({ length: 5 }, (_, index) => ({
			...(firstSeries as Record<string, unknown>),
			id: `series-${index}`
		}));
		expectIssue(series, 'Too big', 'chart series upper bound');

		const highlights = stateWithChart();
		const highlightItem = chartRecordAt(highlights, ['items', 0]);
		const firstHighlight = (highlightItem['highlights'] as unknown[])[0];
		highlightItem['highlights'] = Array.from({ length: 25 }, () => firstHighlight);
		expectIssue(highlights, 'Too big', 'chart highlight upper bound');

		const callouts = stateWithChart();
		const calloutItem = chartRecordAt(callouts, ['items', 0]);
		const firstCallout = (calloutItem['callouts'] as unknown[])[0];
		calloutItem['callouts'] = Array.from({ length: 5 }, () => firstCallout);
		expectIssue(callouts, 'Too big', 'chart callout upper bound');

		const categorySet = stateWithChart();
		const categorySetItem = chartRecordAt(categorySet, ['items', 0]);
		categorySetItem['highlights'] = [
			{
				target: {
					kind: 'category-set',
					seriesId: 'responses',
					categoryIds: Array.from({ length: 13 }, (_, index) => `category-${index}`)
				}
			}
		];
		expectIssue(categorySet, 'Too big', 'chart category-set target upper bound');
	});

	it('accepts only smooth and sharp chart eases', () => {
		for (const ease of ['settled', 'bouncy', 'power2.out']) {
			const state = stateWithChart();
			(
				state.surface['chart'] as {
					items: Array<{ motion: { reveal: { ease: string } } }>;
				}
			).items[0].motion.reveal.ease = ease;
			expectIssue(state, 'Invalid option', `chart ease ${ease}`);
		}
	});

	it('keeps bar/column and normalized variant fields mutually exclusive', () => {
		const bar = stateWithChart();
		(bar.surface['chart'] as { items: Array<Record<string, unknown>> }).items[0]['normalization'] =
			{ total: 1104, unitCount: 100 };
		expectIssue(bar, 'Unrecognized key', 'bar normalization');

		const grid = stateWithChart('unit-grid-chart');
		(grid.surface['chart'] as { items: Array<Record<string, unknown>> }).items[0]['layout'] = {
			mode: 'single'
		};
		expectIssue(grid, 'Unrecognized key', 'unit-grid layout');
	});

	it('resolves chart Block Cascade anchors and rejects unknown ones', () => {
		const valid = stateWithChart();
		valid.overlays = [
			{
				...baseOverlay('overlay'),
				animation: {
					cascade: { anchor: { block: 'bar-chart-a' }, event: 'end', offsetMs: 0 }
				}
			}
		];
		expectValid(valid, 'chart Block Cascade anchor');

		const invalid = structuredClone(valid);
		(
			invalid.overlays[0] as { animation: { cascade: { anchor: { block: string } } } }
		).animation.cascade.anchor.block = 'missing';
		expectIssue(invalid, 'surface.chart.items[].id', 'unknown chart Block anchor');
	});

	it('rejects Diagram/chart collisions in the shared Block identity namespace', () => {
		const state = stateWithChart();
		state.surface['diagram'] = [
			{ id: 'bar-chart-a', type: 'label', position: { x: 0.5, y: 0.5 }, text: 'x' }
		];
		expectIssue(state, 'duplicates a surface.diagram[] Block id', 'Block identity collision');
	});
});

describe('stage camera pose and travel (ADR-0057)', () => {
	it('parses a partial pose with the frontal-camera defaults filled in', () => {
		const stage = StageSchema.parse({ type: 'depth', camera: { pose: { yaw: -24 } } });
		assert.deepEqual(stage.camera.pose, {
			yaw: -24,
			pitch: 0,
			roll: 0,
			distance: 1,
			aim: { x: 0.5, y: 0.5 }
		});
		assert.equal(stage.camera.travel, undefined);
	});

	it('keeps a travel target partial so untravelled fields hold the rest pose', () => {
		const stage = StageSchema.parse({
			type: 'depth',
			camera: { travel: { to: { distance: 0.48, aim: { x: 0.3 } }, start: 0.1, duration: 0.6 } }
		});
		assert.deepEqual(stage.camera.travel, {
			to: { distance: 0.48, aim: { x: 0.3 } },
			start: 0.1,
			duration: 0.6,
			ease: 'smooth'
		});
	});

	it('rejects a pose outside the authored limits', () => {
		for (const pose of [
			{ yaw: 61 },
			{ pitch: -46 },
			{ roll: 31 },
			{ distance: 0.2 },
			{ distance: 2.5 }
		]) {
			assert.equal(
				StageSchema.safeParse({ type: 'depth', camera: { pose } }).success,
				false,
				JSON.stringify(pose)
			);
		}
		assert.equal(
			StageSchema.safeParse({ type: 'depth', camera: { travel: { to: { yaw: 90 } } } }).success,
			false
		);
	});

	it('leaves a legacy camera untouched', () => {
		const stage = StageSchema.parse({ type: 'depth', camera: { move: 'push', amount: 0.6 } });
		assert.equal(stage.camera.pose, undefined);
		assert.equal(stage.camera.travel, undefined);
	});
});

describe('Kinetic Type Field structure (ADR-0063)', () => {
	function kineticWord(id: string, text = 'TYPE'): Record<string, unknown> {
		return {
			type: 'kinetic-word',
			id,
			text,
			hierarchy: 'display',
			ink: 'accent',
			position: { x: 0.5, y: 0.5 },
			scale: 1,
			rotation: 0,
			orientationOverrides: {
				vertical: { position: { x: 0.45, y: 0.62 }, scale: 1.2, rotation: -5 }
			}
		};
	}

	function typeFieldState(field: Record<string, unknown>): WireState {
		const state = baseState();
		state.surface = { type: 'plain', content: { body: '' }, typeField: field };
		return state;
	}

	it('accepts bounded words, semantic phrase order, and complete orientation snapshots', () => {
		const state = typeFieldState({
			words: [kineticWord('type'), { ...kineticWord('moves', 'MOVES'), hierarchy: 'support' }],
			phrases: [{ id: 'opening', wordIds: ['type', 'moves'], focalWordId: 'type' }]
		});

		expectValid(state, 'valid Type Field');
		assert.equal(BlockTypeSchema.safeParse('kinetic-word').success, true);
	});

	it('rejects duplicate identities and unresolved or repeated phrase membership', () => {
		expectIssue(
			typeFieldState({
				words: [kineticWord('type'), kineticWord('type', 'MOVE')],
				phrases: [
					{ id: 'opening', wordIds: ['type', 'missing', 'type'], focalWordId: 'missing' }
				]
			}),
			'Duplicate Type Field word id',
			'duplicate Kinetic Word id'
		);
		expectIssue(
			typeFieldState({
				words: [kineticWord('type')],
				phrases: [{ id: 'opening', wordIds: ['missing'], focalWordId: 'missing' }]
			}),
			'references missing Kinetic Word',
			'missing phrase word'
		);
		expectIssue(
			typeFieldState({
				words: [kineticWord('type')],
				phrases: [{ id: 'opening', wordIds: ['type', 'type'], focalWordId: 'type' }]
			}),
			'more than once',
			'repeated phrase word'
		);
	});

	it('rejects untrimmed multi-token text and incomplete orientation geometry', () => {
		expectIssue(
			typeFieldState({
				words: [kineticWord('type', 'TWO WORDS')],
				phrases: [{ id: 'opening', wordIds: ['type'], focalWordId: 'type' }]
			}),
			'one word token',
			'multi-token Kinetic Word'
		);
		const incomplete = kineticWord('type');
		incomplete.orientationOverrides = {
			vertical: { position: { x: 0.5, y: 0.5 }, scale: 1 }
		};
		expectIssue(
			typeFieldState({
				words: [incomplete],
				phrases: [{ id: 'opening', wordIds: ['type'], focalWordId: 'type' }]
			}),
			'expected number',
			'incomplete Kinetic Word geometry'
		);
	});

	it('enforces word and phrase ceilings', () => {
		const words = Array.from({ length: 17 }, (_, index) => kineticWord(`word-${index}`));
		expectIssue(
			typeFieldState({
				words,
				phrases: [{ id: 'opening', wordIds: ['word-0'], focalWordId: 'word-0' }]
			}),
			'Too big',
			'Kinetic Word ceiling'
		);
		const phrases = Array.from({ length: 9 }, (_, index) => ({
			id: `phrase-${index}`,
			wordIds: ['type'],
			focalWordId: 'type'
		}));
		expectIssue(
			typeFieldState({ words: [kineticWord('type')], phrases }),
			'Too big',
			'Kinetic phrase ceiling'
		);
	});
});

describe('Overlay signed depth and pose (ADR-0057)', () => {
	function overlayState(overlay: Record<string, unknown>): unknown {
		return {
			...baseState(),
			overlays: [
				{
					type: 'lower-third',
					id: 'card',
					content: { variant: 'standard', title: 'Card' },
					position: { anchor: 'bottom-left' },
					...overlay
				}
			]
		};
	}

	it('accepts a lifted depth and a partial pose with zero defaults', () => {
		const parsed = EngineStateSchema.parse(overlayState({ z: -0.18, pose: { yaw: 10 } }));
		assert.equal(parsed.overlays[0].z, -0.18);
		assert.deepEqual(parsed.overlays[0].pose, { yaw: 10, pitch: 0, roll: 0 });
	});

	it('rejects depth and pose outside the authored limits', () => {
		assert.equal(EngineStateSchema.safeParse(overlayState({ z: -1.5 })).success, false);
		assert.equal(EngineStateSchema.safeParse(overlayState({ pose: { pitch: 50 } })).success, false);
	});
});
