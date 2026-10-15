/**
 * The `sound` family's WebMCP tools: what the piece plays
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2,
 * [ADR-0033](../../../docs/adr/0033-sound-design-system.md)).
 *
 * There is no "add automatic cue" tool, and its absence is the design. Every
 * motion primitive already emits a cue at its own frame, derived from the
 * composition rather than stored beside it, so authoring one means saying what
 * that motion plays — `gfx_sound_set_motion_override`. A stored copy would carry
 * a second timing that desyncs the moment the piece is retimed.
 *
 * `gfx_sound_set_cue` is for the sounds no motion emits: a free-standing sting,
 * and the single music bed. It describes a cue whole rather than patching one,
 * because a cue is a sample plus a window and half of that is not a cue.
 *
 * Which motions an override can reach is deliberately narrower than "every
 * window": these are exactly the ones `sound` owns a `sound` key inside. A text
 * animation's and a chart Block's windows belong to `motion` alone, so naming one
 * here earns a refusal rather than a silently ignored argument.
 */
import { SOUND_EVENTS, type SoundOverride } from './engine-schema';
import {
	COMPOSITION_SOUND_CUE_KINDS,
	COMPOSITION_SOUND_BLOCK_PHASES,
	COMPOSITION_SOUND_MOTION_KINDS,
	COMPOSITION_SOUND_MOTION_PHASES,
	runRemoveCompositionSoundCueOperation,
	runSetCompositionMotionSoundOverrideOperation,
	runSetCompositionSoundCueOperation
} from './composition-sound-operations';
import {
	readWebmcpClearableRecordArgument,
	readWebmcpLiteralArgument,
	readWebmcpNumberArgument,
	readWebmcpObservedRevisionArgument,
	readWebmcpOptionalBooleanArgument,
	readWebmcpOptionalLiteralArgument,
	readWebmcpOptionalNumberArgument,
	readWebmcpOptionalStringArgument,
	readWebmcpRecordArgument,
	readWebmcpStringArgument,
	readWebmcpTimeDurationArgument,
	runWebmcpToolOperation,
	WebmcpArgumentError
} from './webmcp-tool-arguments';
import {
	webmcpDerivedEnumProperty,
	webmcpEntityIdProperty,
	webmcpFractionProperty,
	webmcpFractionTimeProperty,
	webmcpObservedRevisionProperty
} from './webmcp-derived-tool-schemas';

import type { CompositionSoundMotion } from './composition-sound-operations';
import type { WebmcpSchemaProperty } from './webmcp-derived-tool-schemas';
import type { WebmcpToolDefinition } from './webmcp-tool-controller';

/** The motion an override hangs on, named the way the Sound rail names its rows. */
function soundMotionProperty(): WebmcpSchemaProperty {
	return {
		type: 'object',
		description: 'Which motion emits the cue being overridden.',
		properties: {
			kind: {
				type: 'string',
				description: 'The element the motion belongs to.',
				enum: COMPOSITION_SOUND_MOTION_KINDS
			},
			phase: {
				type: 'string',
				description:
					"Which edge of the clip, for a Surface or an Overlay; for a diagram Block, its entrance or a node's highlighter swipe.",
				enum: [...COMPOSITION_SOUND_MOTION_PHASES, ...COMPOSITION_SOUND_BLOCK_PHASES.slice(1)]
			},
			overlayId: webmcpEntityIdProperty('The Overlay, when the motion is an Overlay clip.'),
			blockId: webmcpEntityIdProperty(
				'The diagram Block, when the motion is a Block entrance or swipe.'
			),
			markIndex: {
				type: 'integer',
				description: 'The Annotation Mark index, when the motion is a Mark draw-on.',
				minimum: 0
			}
		},
		required: ['kind'],
		additionalProperties: false
	};
}

function readSoundMotion(args: unknown): CompositionSoundMotion {
	const motion = readWebmcpRecordArgument(args, 'motion');
	const kind = readWebmcpLiteralArgument(motion, 'kind', COMPOSITION_SOUND_MOTION_KINDS);
	if (kind === 'mark') {
		return { kind, markIndex: readWebmcpNumberArgument(motion, 'markIndex') };
	}
	if (kind === 'block') {
		return {
			kind,
			blockId: readWebmcpStringArgument(motion, 'blockId'),
			phase: readWebmcpLiteralArgument(motion, 'phase', COMPOSITION_SOUND_BLOCK_PHASES)
		};
	}
	const phase = readWebmcpLiteralArgument(motion, 'phase', COMPOSITION_SOUND_MOTION_PHASES);
	if (kind === 'surface') return { kind, phase };
	return { kind, overlayId: readWebmcpStringArgument(motion, 'overlayId'), phase };
}

/**
 * What one motion plays in place of the cue it would derive. The sample is a
 * bundled slug rather than free text; a composition can still carry a retired
 * Legacy Supers slug, which the asset registry resolves without offering it here.
 */
function soundOverrideProperty(): WebmcpSchemaProperty {
	return {
		description: 'The override to write, or null to return the motion to its own default cue.',
		oneOf: [
			{
				type: 'object',
				description: 'Name the mute, the event, or the sample — at least one of the three.',
				properties: {
					mute: { type: 'boolean', description: 'Emit nothing at all for this motion.' },
					event: webmcpDerivedEnumProperty('sound-event', 'A different motion event to emit.'),
					sample: webmcpDerivedEnumProperty(
						'sound-asset',
						'An explicit bundled audio asset, in place of the event default.'
					)
				},
				additionalProperties: false
			},
			{ type: 'null', description: 'Return this motion to the cue it derives on its own.' }
		]
	};
}

function readSoundOverride(args: unknown): SoundOverride | null {
	const override = readWebmcpClearableRecordArgument(args, 'override');
	if (override === null) return null;
	if (override === undefined) {
		// Absent is not the same as cleared. Returning a motion to its own cue is a
		// decision, and it is spelled `null` so it cannot happen by omission.
		throw new WebmcpArgumentError(
			'invalid_argument',
			'Name the mute, the event, or the sample this motion plays, or null to return it to its own default cue.',
			{ rejected: 'override' }
		);
	}
	return {
		mute: readWebmcpOptionalBooleanArgument(override, 'mute'),
		event: readWebmcpOptionalLiteralArgument(override, 'event', SOUND_EVENTS),
		sample: readWebmcpOptionalStringArgument(override, 'sample')
	};
}

export function listWebmcpSoundToolDefinitions(): readonly WebmcpToolDefinition[] {
	return [
		{
			operationId: 'sound.set-cue',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					cueId: webmcpEntityIdProperty(
						'An existing cue to rewrite. Omit it to add one under a free id.'
					),
					kind: {
						type: 'string',
						description:
							'A free-standing cue, or the single music bed. Defaults to a cue, or to what an existing cue already is.',
						enum: COMPOSITION_SOUND_CUE_KINDS
					},
					assetSlug: webmcpDerivedEnumProperty('sound-asset', 'The bundled audio asset to play.'),
					start: webmcpFractionTimeProperty(
						'Where the cue fires: legacy fraction, seconds, milliseconds, or frames.'
					),
					duration: webmcpFractionTimeProperty(
						'How long it plays: legacy fraction, seconds, milliseconds, or frames.'
					),
					volume: webmcpFractionProperty('Playback level. Omit it to play at full scale.')
				},
				required: ['expectedRevision', 'assetSlug', 'start', 'duration'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('sound.set-cue', () =>
					runSetCompositionSoundCueOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						cueId: readWebmcpOptionalStringArgument(args, 'cueId'),
						kind: readWebmcpOptionalLiteralArgument(args, 'kind', COMPOSITION_SOUND_CUE_KINDS),
						assetSlug: readWebmcpStringArgument(args, 'assetSlug'),
						start: readWebmcpTimeDurationArgument(args, 'start'),
						duration: readWebmcpTimeDurationArgument(args, 'duration'),
						volume: readWebmcpOptionalNumberArgument(args, 'volume')
					})
				)
		},
		{
			operationId: 'sound.remove-cue',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					cueId: webmcpEntityIdProperty('The free-standing cue or bed to remove.')
				},
				required: ['expectedRevision', 'cueId'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('sound.remove-cue', () =>
					runRemoveCompositionSoundCueOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						cueId: readWebmcpStringArgument(args, 'cueId')
					})
				)
		},
		{
			operationId: 'sound.set-motion-override',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					motion: soundMotionProperty(),
					override: soundOverrideProperty()
				},
				required: ['expectedRevision', 'motion', 'override'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('sound.set-motion-override', () =>
					runSetCompositionMotionSoundOverrideOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						motion: readSoundMotion(args),
						override: readSoundOverride(args)
					})
				)
		}
	];
}
