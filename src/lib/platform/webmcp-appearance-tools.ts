/**
 * The `appearance` family's WebMCP tools: how the piece looks under its Pack
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * Binding a Pack is one argument and re-dresses everything. The rest of the
 * family is departures from what that Pack resolved, and each one is clearable
 * for the same reason: `null` gives a decision back to the Pack, where leaving a
 * value in place would freeze whatever the Pack happened to resolve at the time
 * and quietly break the next Pack the composition is shown under (ADR-0039).
 *
 * An Effect's nested parameter object stays open here. Its shape belongs to the
 * Effect's own Pipeline and is only knowable once the caller has named which
 * Effect it means; the Pipeline answers a wrong body with findings naming the
 * exact field. Legacy JSON text remains accepted for existing callers.
 */
import { ANNOTATION_MARK_STYLES } from '../annotations/annotation-mark-styles';
import {
	readWebmcpClearableStringArgument,
	readWebmcpLiteralArgument,
	readWebmcpNumberArgument,
	readWebmcpObservedRevisionArgument,
	readWebmcpOptionalNumberArgument,
	readWebmcpOptionalRuntimeJsonArgument,
	readWebmcpOptionalRecordArgument,
	readWebmcpOptionalStringArgument,
	readWebmcpRuntimeJsonArgument,
	readWebmcpStringArgument,
	runWebmcpToolOperation,
	WebmcpArgumentError
} from './webmcp-tool-arguments';
import {
	runDeleteUserPackOperation,
	runForkUserPackOperation,
	runInspectUserPackStoreOperation,
	runSaveUserPackOperation,
	runValidateUserPackOperation
} from './user-pack-operations';
import {
	runSetCompositionBackdropVisibilityOperation,
	runSetCompositionEffectParamsOperation,
	runSetCompositionMarkDefaultsOperation,
	runSetCompositionPackOperation,
	runSetCompositionStageCameraOperation,
	runSetCompositionStageFocusOperation,
	runSetCompositionStageOperation,
	runSetCompositionTypographyOperation
} from './composition-appearance-operations';
import { runSetCompositionKineticWordAppearanceOperation } from './composition-kinetic-type-operations';
import {
	webmcpClearableTextProperty,
	webmcpDerivedEnumProperty,
	webmcpEntityIdProperty,
	webmcpFractionProperty,
	webmcpFractionTimeProperty,
	webmcpObservedRevisionProperty,
	webmcpRuntimeArrayOrJsonTextProperty,
	webmcpRuntimeObjectOrJsonTextProperty,
	WEBMCP_NO_ARGUMENTS_SCHEMA
} from './webmcp-derived-tool-schemas';

import type { CompositionMarkAppearancePatch } from './composition-appearance-operations';
import {
	KINETIC_WORD_HIERARCHIES,
	KINETIC_WORD_INK_ROLES,
	STAGE_CAMERA_POSE_LIMITS
} from './engine-schema';
import type { AnnotationMarkStyle } from '../annotations/annotation-mark-styles';
import type { WebmcpSchemaProperty } from './webmcp-derived-tool-schemas';
import type { WebmcpToolDefinition } from './webmcp-tool-controller';

/** The revision a User Pack write names: the document's sha-256 contentHash, as listed or receipted. */
function userPackRevisionProperty(): WebmcpSchemaProperty {
	return {
		type: 'string',
		description:
			'The contentHash you read for this User Pack (from the list or a previous receipt); the write applies against it or not at all.',
		minLength: 64,
		maxLength: 64
	};
}

/** A runtime JSON value; absent means "leave it as stored". */
function readOptionalJsonArgument(args: unknown, name: string): unknown {
	return readWebmcpOptionalRuntimeJsonArgument(args, name);
}

/** One mark style's dressing, or `null` to hand the style back to the Pack. */
function markAppearanceProperty(style: string): WebmcpSchemaProperty {
	return {
		description: `How a ${style} Mark is dressed by default.`,
		oneOf: [
			{
				type: 'object',
				description: 'The colour and strength to draw it with.',
				properties: {
					color: { type: 'string', description: 'A #RRGGBB hex.', minLength: 7, maxLength: 7 },
					intensity: webmcpFractionProperty('How strongly the mark lands.')
				},
				additionalProperties: false
			},
			{ type: 'null', description: 'Drop this style back to the Pack default.' }
		]
	};
}

function readMarkDefaults(
	args: unknown
): Partial<Record<AnnotationMarkStyle, CompositionMarkAppearancePatch | null>> {
	const defaults = readWebmcpOptionalRecordArgument(args, 'defaults') ?? {};
	const written: Partial<Record<AnnotationMarkStyle, CompositionMarkAppearancePatch | null>> = {};
	for (const key of Object.keys(defaults)) {
		const style = ANNOTATION_MARK_STYLES.find((candidate) => candidate === key);
		if (!style) {
			throw new WebmcpArgumentError(
				'invalid_argument',
				`"${key}" is not an Annotation Mark style this engine registers.`,
				{ rejected: key, alternatives: ANNOTATION_MARK_STYLES }
			);
		}
		if (defaults[style] === null) {
			written[style] = null;
			continue;
		}
		const patch = readWebmcpOptionalRecordArgument(defaults, style) ?? {};
		written[style] = {
			color: readWebmcpOptionalStringArgument(patch, 'color'),
			intensity: readWebmcpOptionalNumberArgument(patch, 'intensity')
		};
	}
	return written;
}

function stageCameraAngleProperty(description: string, limit: number): WebmcpSchemaProperty {
	return { type: 'number', description, minimum: -limit, maximum: limit };
}

/** A camera pose's fields (ADR-0057): every one optional, so a travel target may name only what moves. */
function stageCameraPoseProperties(): Record<string, WebmcpSchemaProperty> {
	return {
		yaw: stageCameraAngleProperty(
			'Degrees; positive swings the eye to the page’s right.',
			STAGE_CAMERA_POSE_LIMITS.yawDegrees
		),
		pitch: stageCameraAngleProperty(
			'Degrees; positive lifts the eye above the page.',
			STAGE_CAMERA_POSE_LIMITS.pitchDegrees
		),
		roll: stageCameraAngleProperty(
			'Degrees; positive tilts the horizon clockwise.',
			STAGE_CAMERA_POSE_LIMITS.rollDegrees
		),
		distance: {
			type: 'number',
			description: 'The dolly along the line of sight, as a fraction of the rest distance.',
			minimum: STAGE_CAMERA_POSE_LIMITS.minDistance,
			maximum: STAGE_CAMERA_POSE_LIMITS.maxDistance
		},
		aim: {
			type: 'object',
			description: 'The page point the camera orbits and looks at, in composition fractions.',
			properties: {
				x: webmcpFractionProperty('Across the page, 0 left through 1 right.'),
				y: webmcpFractionProperty('Down the page, 0 top through 1 bottom.')
			},
			additionalProperties: false
		}
	};
}

function stageCameraPoseProperty(description: string): WebmcpSchemaProperty {
	return {
		type: 'object',
		description,
		properties: stageCameraPoseProperties(),
		additionalProperties: false
	};
}

function stageCameraTravelProperty(description: string): WebmcpSchemaProperty {
	return {
		type: 'object',
		description,
		properties: {
			to: stageCameraPoseProperty('The pose it eases toward; fields left out hold the rest pose.'),
			start: webmcpFractionProperty('Where the travel opens, as a fraction of the clip.'),
			duration: webmcpFractionProperty('How much of the clip it takes.'),
			ease: webmcpDerivedEnumProperty('motion-ease', 'The curve it travels on.')
		},
		required: ['to'],
		additionalProperties: false
	};
}

/**
 * The stage camera (ADR-0057, ADR-0059, ADR-0060): the legacy move, the rest
 * pose, its one travel, and the vertical pose and travel for the tall frame.
 * Written whole, like the stage.
 */
function stageCameraProperty(): WebmcpSchemaProperty {
	return {
		type: 'object',
		description: 'The whole camera: how it rests, travels, and reflows to the vertical frame.',
		properties: {
			move: webmcpDerivedEnumProperty('stage-camera-move', 'The legacy move it makes.'),
			amount: webmcpFractionProperty('How far the legacy move travels.'),
			ease: webmcpDerivedEnumProperty('motion-ease', 'The curve the legacy move travels on.'),
			pose: stageCameraPoseProperty('The rest pose; omit it for the shipped frontal camera.'),
			travel: stageCameraTravelProperty('One authored move from the rest pose.'),
			vertical: {
				type: 'object',
				description:
					'The camera under a vertical frame: each field present replaces its horizontal counterpart whole.',
				properties: {
					pose: stageCameraPoseProperty('The vertical rest pose.'),
					travel: stageCameraTravelProperty('The vertical travel.')
				},
				additionalProperties: false
			}
		},
		additionalProperties: false
	};
}

/** The stage focus: the focal plane and the lens that renders it. Written whole, like the stage. */
function stageFocusProperty(): WebmcpSchemaProperty {
	return {
		type: 'object',
		description: 'The whole focus: the focal plane and the lens that renders it.',
		properties: {
			focusZ: webmcpFractionProperty('The in-focus depth, 0 near through 1 far.'),
			aperture: webmcpFractionProperty('How strongly out-of-focus depth melts.'),
			band: webmcpFractionProperty('Depth either side of the plane that stays sharp.'),
			pull: {
				type: 'object',
				description: 'A rack focus: the focal plane travels over its own window.',
				properties: {
					from: webmcpFractionProperty('The depth it starts on.'),
					to: webmcpFractionProperty('The depth it lands on.'),
					start: webmcpFractionTimeProperty(
						'Where the pull opens: legacy fraction, seconds, milliseconds, or frames.'
					),
					duration: webmcpFractionTimeProperty(
						'How long it takes: legacy fraction, seconds, milliseconds, or frames.'
					)
				},
				required: ['from', 'to', 'start', 'duration'],
				additionalProperties: false
			}
		},
		additionalProperties: false
	};
}

/**
 * The whole dimensional stage. Written whole rather than merged, so every field
 * a caller leaves out takes the stage schema's own default and a read-back says
 * what the piece composites.
 */
function stageProperty(): WebmcpSchemaProperty {
	return {
		type: 'object',
		description: 'The whole stage. Omit it entirely to remove the stage.',
		properties: {
			type: webmcpDerivedEnumProperty('stage-type', 'Which registered stage composites the piece.'),
			camera: stageCameraProperty(),
			focus: stageFocusProperty(),
			backdrop: {
				type: 'object',
				description: 'What the far plane carries.',
				properties: {
					image: {
						type: 'object',
						description: 'A bundled image on the backdrop plane.',
						properties: {
							asset: webmcpDerivedEnumProperty(
								'stage-backdrop-asset',
								'Which bundled substrate image.'
							)
						},
						required: ['asset'],
						additionalProperties: false
					},
					contrast: webmcpFractionProperty('Centre darkening for near-plane legibility.')
				},
				additionalProperties: false
			}
		},
		required: ['type'],
		additionalProperties: false
	};
}

export function listWebmcpAppearanceToolDefinitions(): readonly WebmcpToolDefinition[] {
	return [
		{
			operationId: 'appearance.set-pack',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					packSlug: {
						description:
							'The Pack to dress this composition in: a registered Pack, or a User Pack slug from gfx_appearance_inspect_user_pack_store. No composition content changes.',
						oneOf: [
							webmcpDerivedEnumProperty('pack-slug', 'A registered Pack.'),
							{
								type: 'string',
								description: 'A User Pack slug the store holds.',
								minLength: 1
							}
						]
					}
				},
				required: ['expectedRevision', 'packSlug'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.set-pack', () =>
					runSetCompositionPackOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						packSlug: readWebmcpStringArgument(args, 'packSlug')
					})
				)
		},
		{
			operationId: 'appearance.inspect-user-pack-store',
			inputSchema: WEBMCP_NO_ARGUMENTS_SCHEMA,
			run: () =>
				runWebmcpToolOperation('appearance.inspect-user-pack-store', () =>
					runInspectUserPackStoreOperation()
				)
		},
		{
			operationId: 'appearance.fork-user-pack',
			inputSchema: {
				type: 'object',
				properties: {
					builtinSlug: webmcpDerivedEnumProperty(
						'pack-slug',
						'The built-in Pack to copy. Only the catalog can be forked.'
					),
					slug: {
						type: 'string',
						description:
							'Lowercase kebab-case slug for the new User Pack. Absent, it is named after its built-in with a -copy suffix.',
						minLength: 1
					},
					label: {
						type: 'string',
						description: 'The label shown in the Pack control.',
						minLength: 1
					},
					description: { type: 'string', description: 'What this pack is for.' }
				},
				required: ['builtinSlug'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.fork-user-pack', () =>
					runForkUserPackOperation({
						builtinSlug: readWebmcpStringArgument(args, 'builtinSlug'),
						slug: readWebmcpOptionalStringArgument(args, 'slug'),
						label: readWebmcpOptionalStringArgument(args, 'label'),
						description: readWebmcpOptionalStringArgument(args, 'description')
					})
				)
		},
		{
			operationId: 'appearance.save-user-pack',
			inputSchema: {
				type: 'object',
				properties: {
					slug: { type: 'string', description: 'Which User Pack to save.', minLength: 1 },
					expectedContentHash: userPackRevisionProperty(),
					document: webmcpRuntimeObjectOrJsonTextProperty(
						'A whole pack manifest ({ slug, label, description, roles, fonts }) replacing the stored one. Exclusive with partial fields.'
					),
					label: { type: 'string', description: 'A new label.', minLength: 1 },
					description: { type: 'string', description: 'A new description.' },
					roles: webmcpRuntimeObjectOrJsonTextProperty(
						'Role names mapped to style or chrome definitions. A null role removes it; omitted roles stay stored.'
					),
					fonts: webmcpRuntimeArrayOrJsonTextProperty(
						'The whole Google Fonts declaration list replacing the stored one.'
					)
				},
				required: ['slug', 'expectedContentHash'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.save-user-pack', () =>
					runSaveUserPackOperation({
						slug: readWebmcpStringArgument(args, 'slug'),
						expectedContentHash: readWebmcpStringArgument(args, 'expectedContentHash'),
						document: readOptionalJsonArgument(args, 'document'),
						label: readWebmcpOptionalStringArgument(args, 'label'),
						description: readWebmcpOptionalStringArgument(args, 'description'),
						roles: readOptionalJsonArgument(args, 'roles') as
							Readonly<Record<string, unknown>> | undefined,
						fonts: readOptionalJsonArgument(args, 'fonts')
					})
				)
		},
		{
			operationId: 'appearance.delete-user-pack',
			inputSchema: {
				type: 'object',
				properties: {
					slug: { type: 'string', description: 'Which User Pack to delete.', minLength: 1 },
					expectedContentHash: userPackRevisionProperty()
				},
				required: ['slug', 'expectedContentHash'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.delete-user-pack', () =>
					runDeleteUserPackOperation({
						slug: readWebmcpStringArgument(args, 'slug'),
						expectedContentHash: readWebmcpStringArgument(args, 'expectedContentHash')
					})
				)
		},
		{
			operationId: 'appearance.validate-user-pack',
			inputSchema: {
				type: 'object',
				properties: {
					document: webmcpRuntimeObjectOrJsonTextProperty(
						'The pack manifest to check ({ slug, label, description, roles, fonts }).'
					)
				},
				required: ['document'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.validate-user-pack', () =>
					runValidateUserPackOperation({
						document: readWebmcpRuntimeJsonArgument(args, 'document')
					})
				)
		},
		{
			operationId: 'appearance.set-typography',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					fontFamily: webmcpDerivedEnumProperty(
						'font-family',
						'The type voice. A Pack that claims the type treatment still overrules it.'
					),
					paperColor: webmcpClearableTextProperty(
						'A #RRGGBB paper colour that wins over the Pack; null returns the Pack field.'
					),
					inkColor: webmcpClearableTextProperty(
						'A #RRGGBB ink colour that wins over the Pack; null returns the Pack ink.'
					)
				},
				required: ['expectedRevision'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.set-typography', () =>
					runSetCompositionTypographyOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						fontFamily: readWebmcpOptionalStringArgument(args, 'fontFamily'),
						paperColor: readWebmcpClearableStringArgument(args, 'paperColor'),
						inkColor: readWebmcpClearableStringArgument(args, 'inkColor')
					})
				)
		},
		{
			operationId: 'appearance.set-kinetic-word-appearance',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					wordId: webmcpEntityIdProperty('The Kinetic Word Block to dress.'),
					hierarchy: webmcpDerivedEnumProperty(
						'kinetic-word-hierarchy',
						'Display carries focal authority; support carries connective copy.'
					),
					ink: webmcpDerivedEnumProperty(
						'kinetic-word-ink-role',
						'The Pack-owned ink or accent colour role.'
					)
				},
				required: ['expectedRevision', 'wordId', 'hierarchy', 'ink'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.set-kinetic-word-appearance', () =>
					runSetCompositionKineticWordAppearanceOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						wordId: readWebmcpStringArgument(args, 'wordId'),
						hierarchy: readWebmcpLiteralArgument(
							args,
							'hierarchy',
							KINETIC_WORD_HIERARCHIES
						),
						ink: readWebmcpLiteralArgument(args, 'ink', KINETIC_WORD_INK_ROLES)
					})
				)
		},
		{
			operationId: 'appearance.set-mark-defaults',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					defaults: {
						type: 'object',
						description: 'The mark styles to dress, one entry per style.',
						properties: Object.fromEntries(
							ANNOTATION_MARK_STYLES.map((style) => [style, markAppearanceProperty(style)])
						),
						additionalProperties: false
					}
				},
				required: ['expectedRevision', 'defaults'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.set-mark-defaults', () =>
					runSetCompositionMarkDefaultsOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						defaults: readMarkDefaults(args)
					})
				)
		},
		{
			operationId: 'appearance.set-effect-params',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					effectId: webmcpEntityIdProperty('The Effect in the chain to tune.'),
					params: webmcpRuntimeObjectOrJsonTextProperty(
						'The parameters in the shape this Effect type declares.'
					)
				},
				required: ['expectedRevision', 'effectId', 'params'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.set-effect-params', () =>
					runSetCompositionEffectParamsOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						effectId: readWebmcpStringArgument(args, 'effectId'),
						params: readWebmcpRuntimeJsonArgument(args, 'params')
					})
				)
		},
		{
			operationId: 'appearance.set-stage',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					stage: stageProperty()
				},
				required: ['expectedRevision'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.set-stage', () =>
					runSetCompositionStageOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						stage: readWebmcpOptionalRecordArgument(args, 'stage') ?? null
					})
				)
		},
		{
			operationId: 'appearance.set-stage-camera',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					camera: stageCameraProperty()
				},
				required: ['expectedRevision', 'camera'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.set-stage-camera', () =>
					runSetCompositionStageCameraOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						camera: readWebmcpOptionalRecordArgument(args, 'camera') ?? {}
					})
				)
		},
		{
			operationId: 'appearance.set-stage-focus',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					focus: stageFocusProperty()
				},
				required: ['expectedRevision', 'focus'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.set-stage-focus', () =>
					runSetCompositionStageFocusOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						focus: readWebmcpOptionalRecordArgument(args, 'focus') ?? {}
					})
				)
		},
		{
			operationId: 'appearance.set-backdrop-visibility',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					visibility: webmcpFractionProperty(
						'0 hides the Surface backdrop entirely; 1 shows all of it.'
					)
				},
				required: ['expectedRevision', 'visibility'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.set-backdrop-visibility', () =>
					runSetCompositionBackdropVisibilityOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						visibility: readWebmcpNumberArgument(args, 'visibility')
					})
				)
		}
	];
}
