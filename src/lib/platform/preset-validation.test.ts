import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { createDefaultEngineState, type Preset } from './engine-schema';
import { validatePresetSemantics } from './preset-validation';
import { TRANSITION_EFFECT_DEFINITION_REGISTRY } from './pipelines/transition-definition-registry';

function videoPreset(name: string): Preset {
	const state = createDefaultEngineState();
	state.media = {
		assets: [
			{
				id: 'asset-a',
				kind: 'video',
				name: 'Source video',
				assetUrl: `/api/user-assets/${'a'.repeat(64)}.mp4`
			}
		],
		videoTrack: {
			clips: [
				{
					id: 'clip-a',
					assetId: 'asset-a',
					timelineStartFrame: 0,
					durationFrames: 180,
					sourceStartSeconds: 0,
					audio: { enabled: true, gain: 1 }
				}
			]
		}
	};
	return { schema: 'gfx@1', name, pack: 'syntax', kind: 'fixture', state };
}

describe('Transition Effect semantic validation', () => {
	it('reports an incomplete transition definition instead of throwing', () => {
		const definition = TRANSITION_EFFECT_DEFINITION_REGISTRY.maskWipe;
		const paramsSchema = definition.paramsSchema;
		assert.equal(Reflect.deleteProperty(definition, 'paramsSchema'), true);

		try {
			const preset: Preset = {
				schema: 'gfx@1',
				name: 'Transition with incomplete definition',
				pack: 'syntax',
				kind: 'fixture',
				state: createDefaultEngineState(),
				transition: {
					from: 'from',
					to: 'to',
					effect: 'mask-wipe',
					durationMs: 600,
					params: {}
				}
			};

			const issues = validatePresetSemantics(preset);

			assert.ok(
				issues.some(
					(issue) =>
						issue.path.join('.') === 'transition.effect' &&
						issue.message.includes('missing its parameter schema')
				)
			);
		} finally {
			definition.paramsSchema = paramsSchema;
		}
	});
});

describe('Variable-weight text effect semantic validation', () => {
	it('allows a capable Pack-dressed title and refuses a Pack-immune document title', () => {
		const state = createDefaultEngineState();
		state.surface.type = 'plain';
		state.textAnimations = [
			{
				id: 'weight-title',
				target: { kind: 'surface', slot: 'title' },
				effect: 'weight-resolve',
				enter: { start: 0.1, duration: 0.1, ease: 'sharp' }
			}
		];
		const preset: Preset = {
			schema: 'gfx@1',
			name: 'Variable weight',
			pack: 'syntax',
			kind: 'fixture',
			state
		};
		assert.ok(
			!validatePresetSemantics(preset).some((issue) =>
				issue.path.join('.').startsWith('state.textAnimations.0.effect')
			)
		);

		state.surface.type = 'paper';
		assert.ok(
			validatePresetSemantics(preset).some(
				(issue) =>
					issue.path.join('.') === 'state.textAnimations.0.effect' &&
					issue.message.includes('Pack-immune surface:paper')
			)
		);
	});
});

describe('Video media semantic validation', () => {
	it('rejects active Video clips on a transition Preset', () => {
		const preset = videoPreset('Transition');
		preset.transition = {
			from: 'from',
			to: 'to',
			effect: 'mask-wipe',
			durationMs: 600,
			params: {}
		};

		const issues = validatePresetSemantics(preset);

		assert.ok(
			issues.some(
				(issue) =>
					issue.path.join('.') === 'state.media.videoTrack.clips' &&
					issue.message.includes('transition Presets')
			)
		);
	});

	it('rejects active Video clip transition endpoints when references resolve', () => {
		const state = createDefaultEngineState();
		const transition: Preset = {
			schema: 'gfx@1',
			name: 'Transition',
			pack: 'syntax',
			kind: 'fixture',
			state,
			transition: {
				from: 'video',
				to: 'plain',
				effect: 'mask-wipe',
				durationMs: 600,
				params: {}
			}
		};
		const video = videoPreset('Video');
		const plain: Preset = {
			schema: 'gfx@1',
			name: 'Plain',
			pack: 'syntax',
			kind: 'fixture',
			state: createDefaultEngineState()
		};

		const issues = validatePresetSemantics(transition, {
			resolvePreset: (slug) => (slug === 'video' ? video : slug === 'plain' ? plain : null)
		});

		assert.ok(
			issues.some(
				(issue) =>
					issue.path.join('.') === 'transition.from' &&
					issue.message.includes('transition snapshots')
			)
		);
		assert.ok(!issues.some((issue) => issue.path.join('.') === 'transition.to'));
	});

	it('enforces unique IDs, reference integrity, ordering, and composition bounds', () => {
		const preset = videoPreset('Invalid media');
		preset.state.media.assets.push({ ...preset.state.media.assets[0] });
		preset.state.media.videoTrack.clips.push(
			{
				...preset.state.media.videoTrack.clips[0],
				assetId: 'missing-asset',
				timelineStartFrame: 120,
				durationFrames: 90
			},
			{
				...preset.state.media.videoTrack.clips[0],
				id: 'clip-b',
				timelineStartFrame: 170,
				durationFrames: 20
			}
		);

		const issues = validatePresetSemantics(preset);
		const messages = issues.map((issue) => issue.message);

		assert.ok(messages.some((message) => message.includes('Duplicate Video asset ID')));
		assert.ok(messages.some((message) => message.includes('Duplicate Video clip ID')));
		assert.ok(messages.some((message) => message.includes('references missing asset')));
		assert.ok(messages.some((message) => message.includes('ordered and non-overlapping')));
		assert.ok(messages.some((message) => message.includes("beyond the composition's 180 frames")));
	});

	it('allows touching clips and ignores unused assets for active-clip restrictions', () => {
		const preset = videoPreset('Touching clips');
		preset.state.media.videoTrack.clips[0].durationFrames = 90;
		preset.state.media.videoTrack.clips.push({
			...preset.state.media.videoTrack.clips[0],
			id: 'clip-b',
			timelineStartFrame: 90
		});
		assert.deepEqual(validatePresetSemantics(preset), []);

		const assetOnly = videoPreset('Asset library only');
		assetOnly.state.media.videoTrack.clips = [];
		assetOnly.transition = {
			from: 'from',
			to: 'to',
			effect: 'mask-wipe',
			durationMs: 600,
			params: {}
		};
		const issues = validatePresetSemantics(assetOnly);
		assert.ok(!issues.some((issue) => issue.path.join('.') === 'state.media.videoTrack.clips'));
	});
});

function chartPresetForSemanticValidation(): Preset {
	const preset: Preset = {
		schema: 'gfx@1',
		name: 'Chart semantic validation',
		pack: 'syntax',
		kind: 'fixture',
		state: createDefaultEngineState()
	};
	preset.state.surface.chart = {
		mode: 'single',
		items: [
			{
				id: 'agent-grid',
				type: 'unit-grid-chart',
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
				normalization: { total: 1104, unitCount: 100 },
				labels: { categories: true, values: true, legend: false },
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
	};
	return preset;
}

describe('Chart semantic validation boundary', () => {
	it('accepts a structurally and semantically valid chart', () => {
		assert.deepEqual(validatePresetSemantics(chartPresetForSemanticValidation()), []);
	});

	it('prefixes chart semantic issues through validatePresetSemantics', () => {
		const preset = chartPresetForSemanticValidation();
		const item = preset.state.surface.chart!.items[0];
		if (item.type !== 'unit-grid-chart') throw new Error('fixture type');
		item.normalization.total = 1000;

		const issues = validatePresetSemantics(preset);
		assert.ok(
			issues.some(
				(issue) =>
					issue.path.join('.') === 'state.surface.chart.items.0.normalization.total' &&
					issue.message.includes('parts sum')
			)
		);
	});
});

describe('Pack semantic validation (ADR-0055 two-source chain)', () => {
	function packPreset(pack: string): Preset {
		return {
			schema: 'gfx@1',
			name: 'Pack under test',
			pack,
			kind: 'fixture',
			state: createDefaultEngineState()
		};
	}

	it('keeps deliverable validation registry-only by default', () => {
		assert.deepEqual(validatePresetSemantics(packPreset('syntax')), []);
		const issues = validatePresetSemantics(packPreset('my-brand'));
		assert.equal(issues.length, 1);
		assert.deepEqual(issues[0].path, ['pack']);
		assert.match(issues[0].message, /Unknown Pack "my-brand"\. Registered Packs: syntax/);
	});

	it('accepts any well-formed User Pack slug for stored documents', () => {
		assert.deepEqual(validatePresetSemantics(packPreset('my-brand'), { packScope: 'stored' }), []);
		const issues = validatePresetSemantics(packPreset('Not A Slug'), { packScope: 'stored' });
		assert.equal(issues.length, 1);
		assert.match(issues[0].message, /nor a valid User Pack slug/);
	});

	it('accepts only loaded User Packs for the open document and drafts', () => {
		const issues = validatePresetSemantics(packPreset('my-brand'), { packScope: 'runtime' });
		assert.equal(issues.length, 1);
		assert.match(issues[0].message, /not loaded from the User Pack store/);
	});
});

describe('depth stage posed Overlay limit (ADR-0057)', () => {
	function stagedPreset(posedCount: number): Preset {
		const state = createDefaultEngineState();
		state.stage = {
			type: 'depth',
			camera: { move: 'static', amount: 0.5, ease: 'smooth' },
			focus: { focusZ: 0, aperture: 0.5, band: 0 }
		};
		state.overlays = Array.from({ length: posedCount + 1 }, (_, index) => ({
			type: 'lower-third',
			id: `card-${index}`,
			content: { variant: 'standard', title: `Card ${index}` },
			position: { anchor: 'bottom-left' },
			...(index < posedCount ? { z: -0.1 * (index + 1) } : {})
		}));
		return { schema: 'gfx@1', name: 'posed', pack: 'syntax', kind: 'fixture', state };
	}

	it('accepts four posed Overlays plus a shared one', () => {
		const issues = validatePresetSemantics(stagedPreset(4));
		assert.equal(
			issues.some((issue) => issue.message.includes('posed Overlays')),
			false
		);
	});

	it('refuses the fifth posed Overlay by name and index', () => {
		const issues = validatePresetSemantics(stagedPreset(5));
		const posedIssue = issues.find((issue) => issue.message.includes('posed Overlays'));
		assert.ok(posedIssue, 'reports the limit');
		assert.deepEqual(posedIssue.path, ['state', 'overlays', 4]);
		assert.ok(posedIssue.message.includes('"card-4"'));
	});
});

describe('website-screenshot capture sources (ADR-0057)', () => {
	function websitePreset(content: Record<string, unknown>): Preset {
		const state = createDefaultEngineState();
		state.surface = {
			type: 'website-screenshot',
			content: {
				body: state.surface.content.body,
				sourceUrl: 'https://github.com/syntaxfm',
				...content
			}
		} as typeof state.surface;
		return { schema: 'gfx@1', name: 'website', pack: 'syntax', kind: 'fixture', state };
	}
	const captureIssues = (preset: Preset) =>
		validatePresetSemantics(preset).filter((issue) => issue.path.includes('content'));

	it('accepts a bundled capture on its own', () => {
		assert.deepEqual(captureIssues(websitePreset({ captureAsset: 'syntax-youtube-videos' })), []);
	});

	it('refuses an unknown bundled capture, both sources, and neither', () => {
		assert.ok(
			captureIssues(websitePreset({ captureAsset: 'missing' })).some((issue) =>
				issue.message.includes('Unknown capture asset')
			)
		);
		assert.ok(
			captureIssues(
				websitePreset({
					captureAsset: 'syntax-youtube-videos',
					imageUrl: `/api/user-assets/${'a'.repeat(64)}.png`
				})
			).some((issue) => issue.message.includes('one capture source'))
		);
		assert.ok(
			captureIssues(websitePreset({})).some((issue) =>
				issue.message.includes('bundled captureAsset')
			)
		);
	});
});
