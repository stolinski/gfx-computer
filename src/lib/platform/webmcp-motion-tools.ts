/**
 * The `motion` family's WebMCP tools: when and how things move
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2,
 * [ADR-0035](../../../docs/adr/0035-generalized-keyframes-and-cascade.md)).
 *
 * Three grammars sit side by side here, and which one an author reaches for is
 * the whole decision this family exposes.
 *
 * - **Clip windows** — enter and exit, as fractions of the clip, so a piece keeps
 *   its shape when the transport duration changes.
 * - **Property channels** — ordered keyframes in milliseconds from the element's
 *   resolved clip start. Declaring one is a transfer of ownership: the
 *   composition takes the pen and the element's Pipeline stops running its own
 *   enter/exit form. That is why clearing a channel is its own tool rather than
 *   an empty track — an empty track renders nothing, which is a different picture.
 * - **Cascade welds** — one entrance hung off another's, offset in milliseconds so
 *   a 120 ms stagger stays 120 ms through a retime.
 *
 * A subject is named as an object rather than as a bare id because the same edit
 * reaches more than one kind of element, and the focus has to land on whichever
 * one it touched. The kinds each tool accepts are its operation's own list, so a
 * chart Block — anchorable, but running the five phases its Pipeline owns — is
 * absent from the channel and weld subjects and present as an anchor.
 *
 * The transition recipe is here too, and is the one thing in this family that is
 * not a property of an element. Declaring one turns the piece into two rendered
 * states plus the Effect that wipes between them, so it is written whole: a
 * recipe half-pointing at one endpoint renders nothing anyone asked for.
 */
import { CHART_MOTION_PHASE_NAMES } from '../utils/chart-motion';
import {
	COMPOSITION_MOTION_EASES,
	runSetCompositionChartMotionOperation,
	runSetCompositionMarkTimingOperation,
	runSetCompositionOverlayTimingOperation,
	runSetCompositionSurfaceTimingOperation,
	runSetCompositionTextAnimationOperation
} from './composition-motion-timing-operations';
import {
	COMPOSITION_CASCADE_ANCHOR_KINDS,
	COMPOSITION_CASCADE_EVENTS,
	COMPOSITION_CASCADE_SUBJECT_KINDS,
	COMPOSITION_KEYFRAME_CHANNEL_SCOPES,
	COMPOSITION_KEYFRAME_SUBJECT_KINDS,
	runClearCompositionCascadeAnchorOperation,
	runClearCompositionKeyframeChannelOperation,
	runSetCompositionCascadeAnchorOperation,
	runSetCompositionKeyframeChannelOperation
} from './composition-keyframe-cascade-operations';
import {
	runSetCompositionKineticWordGlyphStaggerOperation,
	runSetCompositionKineticWordPositionKeyframeOperation
} from './composition-kinetic-type-operations';
import {
	runClearCompositionTransitionOperation,
	runSetCompositionTransitionOperation
} from './composition-transition-operations';
import {
	CHART_MOTION_EASES,
	COMPOSITION_KEYFRAME_LIMIT,
	KINETIC_WORD_GLYPH_STAGGER_LIMIT_MS,
	KINETIC_WORD_GLYPH_STAGGER_ORDERS,
	TEXT_ANIMATION_PARAM_NAMES
} from './engine-schema';
import {
	readWebmcpClearableNumberArgument,
	readWebmcpClearableRecordArgument,
	readWebmcpClearableStringArgument,
	readWebmcpLiteralArgument,
	readWebmcpNumberArgument,
	readWebmcpObservedRevisionArgument,
	readWebmcpOptionalLiteralArgument,
	readWebmcpOptionalRecordArgument,
	readWebmcpOptionalRuntimeJsonArgument,
	readWebmcpRecordArgument,
	readWebmcpRecordArrayArgument,
	readWebmcpStringArgument,
	readWebmcpTimeDurationArgument,
	readWebmcpOptionalTimeDurationArgument,
	runWebmcpToolOperation,
	WebmcpArgumentError
} from './webmcp-tool-arguments';
import {
	webmcpClearableNumberProperty,
	webmcpClearableTextProperty,
	webmcpDerivedEnumProperty,
	webmcpEntityIdProperty,
	webmcpFractionTimeProperty,
	webmcpObservedRevisionProperty,
	webmcpObservedRevisionOnlySchema,
	webmcpRuntimeObjectOrJsonTextProperty
} from './webmcp-derived-tool-schemas';

import type { ChartMotionPhaseName } from '../utils/chart-motion';
import type { CompositionChartMotionPhaseInput } from './composition-motion-timing-operations';
import type { CompositionMotionWindow } from './composition-motion-timing-operations';
import type {
	CompositionCascadeAnchorKind,
	CompositionCascadeSubject,
	CompositionKeyframeSubject
} from './composition-keyframe-cascade-operations';
import type {
	CascadeAnchor,
	Keyframe,
	KineticWordGlyphStagger,
	TextAnimationParams
} from './engine-schema';
import type { WebmcpSchemaProperty } from './webmcp-derived-tool-schemas';
import type { WebmcpToolDefinition } from './webmcp-tool-controller';

/**
 * The argument each kind of element is named by. The Surface has none: a
 * composition holds exactly one, so naming its kind has already named it.
 */
function subjectIdProperties(): Readonly<
	Record<CompositionCascadeAnchorKind, { field: string; property: WebmcpSchemaProperty } | null>
> {
	return {
		surface: null,
		overlay: { field: 'overlayId', property: webmcpEntityIdProperty('The Overlay this names.') },
		mark: {
			field: 'markIndex',
			property: {
				type: 'integer',
				description: 'The Annotation Mark index, in document order.',
				minimum: 0
			}
		},
		'text-animation': {
			field: 'textAnimationId',
			property: webmcpEntityIdProperty('The text animation this names.')
		},
		block: { field: 'blockId', property: webmcpEntityIdProperty('The Block this names.') }
	};
}

/**
 * The element an edit acts on, carrying only the id fields the kinds it accepts
 * are named by — a channel subject is never a Mark, so it never offers a Mark
 * index. The parameter takes the anchor kinds because those are the widest set;
 * every other list here is a subset of them.
 */
function elementSubjectProperty(
	kinds: readonly CompositionCascadeAnchorKind[],
	description: string
): WebmcpSchemaProperty {
	const identifiers = subjectIdProperties();
	const properties: Record<string, WebmcpSchemaProperty> = {
		kind: { type: 'string', description: 'Which kind of element this names.', enum: kinds }
	};
	for (const kind of kinds) {
		const identifier = identifiers[kind];
		if (identifier) properties[identifier.field] = identifier.property;
	}

	return {
		type: 'object',
		description,
		properties,
		required: ['kind'],
		additionalProperties: false
	};
}

function readKeyframeSubject(args: unknown): CompositionKeyframeSubject {
	const subject = readWebmcpRecordArgument(args, 'subject');
	const kind = readWebmcpLiteralArgument(subject, 'kind', COMPOSITION_KEYFRAME_SUBJECT_KINDS);
	if (kind === 'surface') return { kind };
	if (kind === 'overlay')
		return { kind, overlayId: readWebmcpStringArgument(subject, 'overlayId') };
	return { kind, blockId: readWebmcpStringArgument(subject, 'blockId') };
}

function readCascadeSubject(args: unknown): CompositionCascadeSubject {
	const subject = readWebmcpRecordArgument(args, 'subject');
	const kind = readWebmcpLiteralArgument(subject, 'kind', COMPOSITION_CASCADE_SUBJECT_KINDS);
	switch (kind) {
		case 'overlay':
			return { kind, overlayId: readWebmcpStringArgument(subject, 'overlayId') };
		case 'mark':
			return { kind, markIndex: readWebmcpNumberArgument(subject, 'markIndex') };
		case 'text-animation':
			return { kind, textAnimationId: readWebmcpStringArgument(subject, 'textAnimationId') };
		case 'block':
			return { kind, blockId: readWebmcpStringArgument(subject, 'blockId') };
	}
}

/** The element a weld hangs from, in the shape the composition stores it. */
function readCascadeAnchor(args: unknown): CascadeAnchor {
	const anchor = readWebmcpRecordArgument(args, 'anchor');
	const kind = readWebmcpLiteralArgument(anchor, 'kind', COMPOSITION_CASCADE_ANCHOR_KINDS);
	switch (kind) {
		case 'surface':
			return 'surface';
		case 'overlay':
			return { overlay: readWebmcpStringArgument(anchor, 'overlayId') };
		case 'mark':
			return { mark: readWebmcpNumberArgument(anchor, 'markIndex') };
		case 'text-animation':
			return { textAnimation: readWebmcpStringArgument(anchor, 'textAnimationId') };
		case 'block':
			return { block: readWebmcpStringArgument(anchor, 'blockId') };
	}
}

function motionWindowProperty(description: string): WebmcpSchemaProperty {
	return {
		type: 'object',
		description,
		properties: {
			start: webmcpFractionTimeProperty(
				'Where the window opens: legacy fraction, seconds, milliseconds, or frames.'
			),
			duration: webmcpFractionTimeProperty(
				'How long it runs: legacy fraction, seconds, milliseconds, or frames.'
			),
			ease: webmcpDerivedEnumProperty('motion-ease', 'The curve the window runs on.')
		},
		required: ['start', 'duration', 'ease'],
		additionalProperties: false
	};
}

/**
 * The same window, removable. A window is replaced whole rather than merged, and
 * removing it removes the motion — so the cue that motion emitted goes with it,
 * while retiming carries that cue onto the new window.
 */
function clearableMotionWindowProperty(description: string): WebmcpSchemaProperty {
	return {
		description,
		oneOf: [
			motionWindowProperty('The window to write, whole.'),
			{ type: 'null', description: 'Remove this motion, and the cue it emitted with it.' }
		]
	};
}

function readMotionWindowFields(window: Record<string, unknown>): CompositionMotionWindow {
	return {
		start: readWebmcpTimeDurationArgument(window, 'start'),
		duration: readWebmcpTimeDurationArgument(window, 'duration'),
		ease: readWebmcpLiteralArgument(window, 'ease', COMPOSITION_MOTION_EASES)
	};
}

function readMotionWindow(args: unknown, name: string): CompositionMotionWindow | undefined {
	const window = readWebmcpOptionalRecordArgument(args, name);
	return window ? readMotionWindowFields(window) : undefined;
}

function readClearableMotionWindow(
	args: unknown,
	name: string
): CompositionMotionWindow | null | undefined {
	const window = readWebmcpClearableRecordArgument(args, name);
	if (window === undefined || window === null) return window;
	return readMotionWindowFields(window);
}

/**
 * One property track. `atMs` counts from the element's resolved clip start, so
 * authored motion survives a retime; the first keyframe carries no ease, because
 * ease is the curve into a keyframe and nothing precedes the first.
 */
function keyframeTrackProperty(): WebmcpSchemaProperty {
	return {
		type: 'array',
		description:
			'The ordered keyframes, by strictly ascending atMs. At least one; clear the channel instead of sending none.',
		minItems: 1,
		maxItems: COMPOSITION_KEYFRAME_LIMIT,
		items: {
			type: 'object',
			description: 'One keyframe on this channel.',
			properties: {
				atMs: {
					type: 'number',
					description: "Milliseconds from the element's resolved clip start.",
					minimum: 0
				},
				value: { type: 'number', description: 'The channel value at this keyframe.' },
				ease: webmcpDerivedEnumProperty(
					'motion-ease',
					'The curve into this keyframe. The first keyframe carries none.'
				)
			},
			required: ['atMs', 'value'],
			additionalProperties: false
		}
	};
}

function readKeyframes(args: unknown): readonly Keyframe[] {
	return readWebmcpRecordArrayArgument(args, 'keyframes').map((frame) => ({
		atMs: readWebmcpNumberArgument(frame, 'atMs'),
		value: readWebmcpNumberArgument(frame, 'value'),
		ease: readWebmcpOptionalLiteralArgument(frame, 'ease', COMPOSITION_MOTION_EASES)
	}));
}

/** A glyph stagger, or `null` to return the word to one text run. */
function readGlyphStagger(args: unknown): KineticWordGlyphStagger | null {
	const record = readWebmcpClearableRecordArgument(args, 'glyphStagger');
	if (record === undefined) {
		throw new WebmcpArgumentError(
			'invalid_argument',
			'"glyphStagger" is required: an object, or null to clear.'
		);
	}
	if (record === null) return null;
	return {
		offsetMs: readWebmcpNumberArgument(record, 'offsetMs'),
		order: readWebmcpLiteralArgument(record, 'order', KINETIC_WORD_GLYPH_STAGGER_ORDERS)
	};
}

function textAnimationParamsProperty(): WebmcpSchemaProperty {
	return {
		type: 'object',
		description:
			"The effect parameters to write. Each one is clearable, which returns it to the effect's own default.",
		properties: Object.fromEntries(
			TEXT_ANIMATION_PARAM_NAMES.map((name) => [
				name,
				webmcpClearableNumberProperty(`The ${name} parameter, where the effect honours one.`)
			])
		),
		additionalProperties: false
	};
}

function readTextAnimationParams(
	args: unknown
): Partial<Record<keyof TextAnimationParams, number | null>> | undefined {
	const params = readWebmcpOptionalRecordArgument(args, 'params');
	if (!params) return undefined;

	const declared: readonly string[] = TEXT_ANIMATION_PARAM_NAMES;
	for (const key of Object.keys(params)) {
		if (declared.includes(key)) continue;
		throw new WebmcpArgumentError(
			'invalid_argument',
			`"${key}" is not a parameter a text effect accepts.`,
			{ rejected: key, alternatives: declared }
		);
	}

	const patch: Partial<Record<keyof TextAnimationParams, number | null>> = {};
	for (const name of TEXT_ANIMATION_PARAM_NAMES) {
		const value = readWebmcpClearableNumberArgument(params, name);
		if (value !== undefined) patch[name] = value;
	}
	return patch;
}

/**
 * The five phases a chart Block runs, moved as a set. A caller shifting the whole
 * run later would otherwise collide with a phase the same edit is about to move.
 */
function chartPhasesProperty(): WebmcpSchemaProperty {
	return {
		type: 'object',
		description: 'The phases to retime. The ones left out keep the windows they hold.',
		properties: Object.fromEntries(
			CHART_MOTION_PHASE_NAMES.map((name) => [
				name,
				{
					type: 'object',
					description: `The ${name} phase window.`,
					properties: {
						start: webmcpFractionTimeProperty(
							'Where the phase opens: legacy fraction, seconds, milliseconds, or frames.'
						),
						duration: webmcpFractionTimeProperty(
							'How long it runs: legacy fraction, seconds, milliseconds, or frames.'
						),
						ease: webmcpDerivedEnumProperty(
							'chart-motion-ease',
							'The curve this phase runs on. Chart phases run their own two curves.'
						)
					},
					required: ['start', 'duration'],
					additionalProperties: false
				} satisfies WebmcpSchemaProperty
			])
		),
		additionalProperties: false
	};
}

/** The wipe parameters its registered transition Effect validates. */
function readTransitionParams(args: unknown): unknown {
	return readWebmcpOptionalRuntimeJsonArgument(args, 'params');
}

function readChartPhases(
	args: unknown
): Partial<Record<ChartMotionPhaseName, CompositionChartMotionPhaseInput>> {
	const phases = readWebmcpRecordArgument(args, 'phases');
	const declared: readonly string[] = CHART_MOTION_PHASE_NAMES;
	for (const key of Object.keys(phases)) {
		if (declared.includes(key)) continue;
		throw new WebmcpArgumentError('invalid_argument', `"${key}" is not a chart motion phase.`, {
			rejected: key,
			alternatives: declared
		});
	}

	const requested: Partial<Record<ChartMotionPhaseName, CompositionChartMotionPhaseInput>> = {};
	for (const name of CHART_MOTION_PHASE_NAMES) {
		const phase = readWebmcpOptionalRecordArgument(phases, name);
		if (!phase) continue;
		requested[name] = {
			start: readWebmcpTimeDurationArgument(phase, 'start'),
			duration: readWebmcpTimeDurationArgument(phase, 'duration'),
			ease: readWebmcpOptionalLiteralArgument(phase, 'ease', CHART_MOTION_EASES)
		};
	}
	return requested;
}

export function listWebmcpMotionToolDefinitions(): readonly WebmcpToolDefinition[] {
	return [
		{
			operationId: 'motion.set-surface-timing',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					enter: clearableMotionWindowProperty(
						'The Surface entrance. Everything anchored to the Surface resolves against it.'
					),
					exit: clearableMotionWindowProperty('The Surface exit.')
				},
				required: ['expectedRevision'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('motion.set-surface-timing', () =>
					runSetCompositionSurfaceTimingOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						enter: readClearableMotionWindow(args, 'enter'),
						exit: readClearableMotionWindow(args, 'exit')
					})
				)
		},
		{
			operationId: 'motion.set-overlay-timing',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					overlayId: webmcpEntityIdProperty('The Overlay to retime.'),
					enter: clearableMotionWindowProperty('The Overlay entrance.'),
					exit: clearableMotionWindowProperty('The Overlay exit.')
				},
				required: ['expectedRevision', 'overlayId'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('motion.set-overlay-timing', () =>
					runSetCompositionOverlayTimingOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						overlayId: readWebmcpStringArgument(args, 'overlayId'),
						enter: readClearableMotionWindow(args, 'enter'),
						exit: readClearableMotionWindow(args, 'exit')
					})
				)
		},
		{
			operationId: 'motion.set-mark-timing',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					markIndex: {
						type: 'integer',
						description: 'The Annotation Mark index, in document order.',
						minimum: 0
					},
					start: webmcpFractionTimeProperty(
						'Where the draw-on begins: legacy fraction, seconds, milliseconds, or frames.'
					),
					duration: webmcpFractionTimeProperty(
						'How long it draws: legacy fraction, seconds, milliseconds, or frames.'
					),
					ease: webmcpDerivedEnumProperty('motion-ease', 'The curve the draw-on runs on.'),
					color: webmcpClearableTextProperty(
						"This Mark's departure from the mark defaults, as a #RRGGBB hex. Null returns it to them."
					),
					intensity: webmcpClearableNumberProperty(
						"This Mark's ink strength. Null returns it to the mark defaults.",
						{ minimum: 0, maximum: 1 }
					)
				},
				required: ['expectedRevision', 'markIndex'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('motion.set-mark-timing', () =>
					runSetCompositionMarkTimingOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						markIndex: readWebmcpNumberArgument(args, 'markIndex'),
						start: readWebmcpOptionalTimeDurationArgument(args, 'start'),
						duration: readWebmcpOptionalTimeDurationArgument(args, 'duration'),
						ease: readWebmcpOptionalLiteralArgument(args, 'ease', COMPOSITION_MOTION_EASES),
						color: readWebmcpClearableStringArgument(args, 'color'),
						intensity: readWebmcpClearableNumberArgument(args, 'intensity')
					})
				)
		},
		{
			operationId: 'motion.set-text-animation',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					textAnimationId: webmcpEntityIdProperty('The text animation to retime.'),
					enter: motionWindowProperty(
						'The entrance window. A text animation always has one; retime it rather than removing it.'
					),
					exit: clearableMotionWindowProperty('The exit window, which a text animation may omit.'),
					params: textAnimationParamsProperty()
				},
				required: ['expectedRevision', 'textAnimationId'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('motion.set-text-animation', () =>
					runSetCompositionTextAnimationOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						textAnimationId: readWebmcpStringArgument(args, 'textAnimationId'),
						enter: readMotionWindow(args, 'enter'),
						exit: readClearableMotionWindow(args, 'exit'),
						params: readTextAnimationParams(args)
					})
				)
		},
		{
			operationId: 'motion.set-keyframe-channel',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					subject: elementSubjectProperty(
						COMPOSITION_KEYFRAME_SUBJECT_KINDS,
						"The element that takes the pen. Declaring any channel stops its Pipeline's intrinsic motion form."
					),
					channel: webmcpDerivedEnumProperty(
						'keyframe-channel',
						'The property to author. A subject that declares no such channel names the ones it does.'
					),
					keyframes: keyframeTrackProperty(),
					scope: {
						type: 'string',
						description:
							'Shared by default. Horizontal or vertical is valid only for a Kinetic Word spatial channel and replaces that orientation spatial group.',
						enum: COMPOSITION_KEYFRAME_CHANNEL_SCOPES
					}
				},
				required: ['expectedRevision', 'subject', 'channel', 'keyframes'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('motion.set-keyframe-channel', () =>
					runSetCompositionKeyframeChannelOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						subject: readKeyframeSubject(args),
						channel: readWebmcpStringArgument(args, 'channel'),
						scope: readWebmcpOptionalLiteralArgument(
							args,
							'scope',
							COMPOSITION_KEYFRAME_CHANNEL_SCOPES
						),
						keyframes: readKeyframes(args)
					})
				)
		},
		{
			operationId: 'motion.set-kinetic-word-position-keyframe',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					wordId: webmcpEntityIdProperty('The Kinetic Word Block to key.'),
					scope: {
						type: 'string',
						description:
							'Shared spatial motion, or the complete horizontal/vertical replacement group.',
						enum: COMPOSITION_KEYFRAME_CHANNEL_SCOPES
					},
					atMs: {
						type: 'number',
						description: 'Milliseconds from composition start.',
						minimum: 0
					},
					x: {
						type: 'number',
						description: 'Composition-fraction X delta from the active orientation base placement.'
					},
					y: {
						type: 'number',
						description: 'Composition-fraction Y delta from the active orientation base placement.'
					},
					ease: webmcpDerivedEnumProperty(
						'motion-ease',
						'The curve into this position keyframe. Omit at t=0.'
					)
				},
				required: 'expectedRevision wordId scope atMs x y'.split(' '),
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('motion.set-kinetic-word-position-keyframe', () =>
					runSetCompositionKineticWordPositionKeyframeOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						wordId: readWebmcpStringArgument(args, 'wordId'),
						scope: readWebmcpLiteralArgument(args, 'scope', COMPOSITION_KEYFRAME_CHANNEL_SCOPES),
						atMs: readWebmcpNumberArgument(args, 'atMs'),
						x: readWebmcpNumberArgument(args, 'x'),
						y: readWebmcpNumberArgument(args, 'y'),
						ease: readWebmcpOptionalLiteralArgument(args, 'ease', COMPOSITION_MOTION_EASES)
					})
				)
		},
		{
			operationId: 'motion.set-kinetic-word-glyph-stagger',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					wordId: webmcpEntityIdProperty('The Kinetic Word Block whose glyphs stagger.'),
					glyphStagger: {
						description:
							"How far behind the first glyph each later glyph plays the word's reveal track, or null for one unstaggered text run.",
						oneOf: [
							{
								type: 'object',
								description: 'A per-glyph delay and the order glyphs take it in.',
								properties: {
									offsetMs: {
										type: 'integer',
										description: `Milliseconds between successive glyphs, 0 through ${KINETIC_WORD_GLYPH_STAGGER_LIMIT_MS}.`,
										minimum: 0,
										maximum: KINETIC_WORD_GLYPH_STAGGER_LIMIT_MS
									},
									order: webmcpDerivedEnumProperty(
										'kinetic-word-glyph-stagger-order',
										'Forward reads left to right, reverse right to left, center blooms outward from the middle.'
									)
								},
								required: ['offsetMs', 'order'],
								additionalProperties: false
							},
							{ type: 'null', description: 'Return the word to one unstaggered text run.' }
						]
					}
				},
				required: ['expectedRevision', 'wordId', 'glyphStagger'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('motion.set-kinetic-word-glyph-stagger', () =>
					runSetCompositionKineticWordGlyphStaggerOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						wordId: readWebmcpStringArgument(args, 'wordId'),
						glyphStagger: readGlyphStagger(args)
					})
				)
		},
		{
			operationId: 'motion.clear-keyframe-channel',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					subject: elementSubjectProperty(
						COMPOSITION_KEYFRAME_SUBJECT_KINDS,
						'The element that hands the pen back.'
					),
					channel: webmcpDerivedEnumProperty('keyframe-channel', 'The authored channel to remove.'),
					scope: {
						type: 'string',
						description:
							'Shared by default. Horizontal or vertical is valid only for a Kinetic Word spatial channel.',
						enum: COMPOSITION_KEYFRAME_CHANNEL_SCOPES
					}
				},
				required: ['expectedRevision', 'subject', 'channel'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('motion.clear-keyframe-channel', () =>
					runClearCompositionKeyframeChannelOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						subject: readKeyframeSubject(args),
						channel: readWebmcpStringArgument(args, 'channel'),
						scope: readWebmcpOptionalLiteralArgument(
							args,
							'scope',
							COMPOSITION_KEYFRAME_CHANNEL_SCOPES
						)
					})
				)
		},
		{
			operationId: 'motion.set-cascade-anchor',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					subject: elementSubjectProperty(
						COMPOSITION_CASCADE_SUBJECT_KINDS,
						'The element whose entrance is being welded.'
					),
					anchor: elementSubjectProperty(
						COMPOSITION_CASCADE_ANCHOR_KINDS,
						'The element it welds to. Cycles and missing anchors are refused before the edit applies.'
					),
					event: {
						type: 'string',
						description: "Which edge of the anchor's entrance the weld hangs from.",
						enum: COMPOSITION_CASCADE_EVENTS
					},
					offsetMs: {
						type: 'number',
						description:
							'Milliseconds after the anchor event; negative leads it. Milliseconds, so a stagger survives a retime.'
					}
				},
				required: ['expectedRevision', 'subject', 'anchor', 'event', 'offsetMs'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('motion.set-cascade-anchor', () =>
					runSetCompositionCascadeAnchorOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						subject: readCascadeSubject(args),
						anchor: readCascadeAnchor(args),
						event: readWebmcpLiteralArgument(args, 'event', COMPOSITION_CASCADE_EVENTS),
						offsetMs: readWebmcpNumberArgument(args, 'offsetMs')
					})
				)
		},
		{
			operationId: 'motion.clear-cascade-anchor',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					subject: elementSubjectProperty(
						COMPOSITION_CASCADE_SUBJECT_KINDS,
						'The element that times from the composition start again.'
					)
				},
				required: ['expectedRevision', 'subject'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('motion.clear-cascade-anchor', () =>
					runClearCompositionCascadeAnchorOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						subject: readCascadeSubject(args)
					})
				)
		},
		{
			operationId: 'motion.set-chart-motion',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					blockId: webmcpEntityIdProperty('The chart Block to retime.'),
					phases: chartPhasesProperty()
				},
				required: ['expectedRevision', 'blockId', 'phases'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('motion.set-chart-motion', () =>
					runSetCompositionChartMotionOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						blockId: readWebmcpStringArgument(args, 'blockId'),
						phases: readChartPhases(args)
					})
				)
		},
		{
			operationId: 'motion.set-composition-transition',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					from: webmcpDerivedEnumProperty(
						'transition-endpoint-slug',
						'The composition the wipe starts from.'
					),
					to: webmcpDerivedEnumProperty(
						'transition-endpoint-slug',
						'The composition the wipe lands on.'
					),
					effect: webmcpDerivedEnumProperty('transition-effect', 'The registered wipe to run.'),
					durationMs: {
						type: 'number',
						description:
							'How long the wipe itself runs. Milliseconds, because it belongs to the wipe rather than to either state transport.',
						minimum: 0
					},
					params: webmcpRuntimeObjectOrJsonTextProperty(
						"Parameters for the wipe against the Effect's schema. Omit them to take its defaults."
					)
				},
				required: ['expectedRevision', 'from', 'to', 'effect', 'durationMs'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('motion.set-composition-transition', () =>
					runSetCompositionTransitionOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						from: readWebmcpStringArgument(args, 'from'),
						to: readWebmcpStringArgument(args, 'to'),
						effect: readWebmcpStringArgument(args, 'effect'),
						durationMs: readWebmcpNumberArgument(args, 'durationMs'),
						params: readTransitionParams(args)
					})
				)
		},
		{
			operationId: 'motion.clear-composition-transition',
			inputSchema: webmcpObservedRevisionOnlySchema(),
			run: (args) =>
				runWebmcpToolOperation('motion.clear-composition-transition', () =>
					runClearCompositionTransitionOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args)
					})
				)
		}
	];
}
