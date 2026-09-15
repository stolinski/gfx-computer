/**
 * The `layer` family's WebMCP tools: which Layer entities exist, in what order,
 * and which registered variant each one is
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * This is the family an agent builds structure with, so every type argument is
 * an enum read from the live Pipeline registry — a Surface this engine gains is
 * a Surface the tool offers on the next load, with no list to edit.
 *
 * An entity id is the deliberate exception. Ids are made as entities are added,
 * and these schemas are built once when the controller starts, so an id enum
 * would be a snapshot of a composition the caller has since edited. Every
 * removal and reorder therefore takes a free-string id, and the operation
 * answers an unknown one with the ids the composition holds right now — the
 * same reason a session slug stays a string in the `composition` family.
 *
 * The Surface's variant, site, and chrome are also free of a single enum,
 * because which of them exists at all is the chosen Surface's decision: the
 * operation names that Surface's own variants when one does not fit, rather than
 * offering an agent a union of every Surface's variants at registration time.
 */
import { ANNOTATION_MARK_STYLES } from '../annotations/annotation-mark-styles';
import {
	ChartTypeSchema,
	DIAGRAM_PRIMITIVE_TYPES,
	SURFACE_CHROME_MODES,
	TEXT_ANIMATION_OVERLAY_SLOTS,
	TEXT_ANIMATION_SURFACE_SLOTS,
	TEXT_ANIMATION_TARGET_KINDS,
	type TextAnimationTarget
} from './engine-schema';
import {
	readWebmcpLiteralArgument,
	readWebmcpNumberArgument,
	readWebmcpObservedRevisionArgument,
	readWebmcpOptionalLiteralArgument,
	readWebmcpOptionalStringArgument,
	readWebmcpRecordArgument,
	readWebmcpStringArgument,
	runWebmcpToolOperation
} from './webmcp-tool-arguments';
import {
	runAddCompositionAnnotationMarkOperation,
	runAddCompositionEffectOperation,
	runAddCompositionOverlayOperation,
	runAddCompositionTextAnimationOperation,
	runRemoveCompositionAnnotationMarkOperation,
	runRemoveCompositionEffectOperation,
	runRemoveCompositionOverlayOperation,
	runRemoveCompositionTextAnimationOperation,
	runReorderCompositionEffectOperation,
	runReorderCompositionOverlayOperation,
	runSetCompositionSurfaceOperation
} from './composition-layer-operations';
import {
	runAddCompositionChartBlockOperation,
	runAddCompositionDiagramPrimitiveOperation,
	runRemoveCompositionChartBlockOperation,
	runRemoveCompositionDiagramPrimitiveOperation
} from './composition-block-layer-operations';
import {
	runAddCompositionKineticWordOperation,
	runRemoveCompositionKineticWordOperation
} from './composition-kinetic-type-operations';
import {
	webmcpDerivedEnumProperty,
	webmcpEntityIdProperty,
	webmcpObservedRevisionProperty
} from './webmcp-derived-tool-schemas';

import type { WebmcpSchemaProperty } from './webmcp-derived-tool-schemas';
import type { WebmcpToolDefinition } from './webmcp-tool-controller';

/** An index into a live list; the operation bounds it against the list it names. */
function entryIndexProperty(description: string): WebmcpSchemaProperty {
	return { type: 'integer', description, minimum: 0 };
}

/**
 * The content slot a text animation binds to. The slot vocabulary depends on
 * which kind of element carries it, so both are declared and the operation reads
 * the one the caller's `kind` names.
 */
function textAnimationTargetProperty(): WebmcpSchemaProperty {
	return {
		type: 'object',
		description: 'The single content slot this animation animates.',
		properties: {
			kind: webmcpDerivedEnumProperty(
				'text-animation-target-kind',
				'Whether the slot belongs to the Surface or to an Overlay.'
			),
			overlayId: webmcpEntityIdProperty('The Overlay carrying the slot, for an overlay target.'),
			slot: {
				type: 'string',
				description: 'The slot itself: a Surface slot, or an Overlay slot for an overlay target.',
				enum: [...new Set([...TEXT_ANIMATION_SURFACE_SLOTS, ...TEXT_ANIMATION_OVERLAY_SLOTS])]
			}
		},
		required: ['kind', 'slot'],
		additionalProperties: false
	};
}

function readTextAnimationTarget(args: unknown): TextAnimationTarget {
	const target = readWebmcpRecordArgument(args, 'target');
	const kind = readWebmcpLiteralArgument(target, 'kind', TEXT_ANIMATION_TARGET_KINDS);
	if (kind === 'surface') {
		return { kind, slot: readWebmcpLiteralArgument(target, 'slot', TEXT_ANIMATION_SURFACE_SLOTS) };
	}
	return {
		kind,
		overlayId: readWebmcpStringArgument(target, 'overlayId'),
		slot: readWebmcpLiteralArgument(target, 'slot', TEXT_ANIMATION_OVERLAY_SLOTS)
	};
}

export function listWebmcpLayerToolDefinitions(): readonly WebmcpToolDefinition[] {
	return [
		{
			operationId: 'layer.set-surface',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					surfaceType: webmcpDerivedEnumProperty(
						'surface-type',
						'The Surface this composition renders on. Authored content survives the swap.'
					),
					variant: {
						type: 'string',
						description:
							'The variant id, where the chosen Surface declares variants. A Surface that declares none names that.',
						minLength: 1
					},
					site: webmcpDerivedEnumProperty(
						'web-document-site',
						'The site a web-document Surface mocks.'
					),
					chrome: webmcpDerivedEnumProperty(
						'surface-chrome-mode',
						'The chrome mode, where the chosen Surface declares one.'
					)
				},
				required: ['expectedRevision', 'surfaceType'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.set-surface', () =>
					runSetCompositionSurfaceOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						surfaceType: readWebmcpStringArgument(args, 'surfaceType'),
						variant: readWebmcpOptionalStringArgument(args, 'variant'),
						site: readWebmcpOptionalStringArgument(args, 'site'),
						chrome: readWebmcpOptionalLiteralArgument(args, 'chrome', SURFACE_CHROME_MODES)
					})
				)
		},
		{
			operationId: 'layer.add-overlay',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					overlayType: webmcpDerivedEnumProperty(
						'overlay-type',
						'The Overlay to add. It arrives with the defaults its Pipeline declares.'
					)
				},
				required: ['expectedRevision', 'overlayType'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.add-overlay', () =>
					runAddCompositionOverlayOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						overlayType: readWebmcpStringArgument(args, 'overlayType')
					})
				)
		},
		{
			operationId: 'layer.remove-overlay',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					overlayId: webmcpEntityIdProperty('The Overlay to remove.')
				},
				required: ['expectedRevision', 'overlayId'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.remove-overlay', () =>
					runRemoveCompositionOverlayOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						overlayId: readWebmcpStringArgument(args, 'overlayId')
					})
				)
		},
		{
			operationId: 'layer.reorder-overlay',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					overlayId: webmcpEntityIdProperty('The Overlay to move.'),
					index: entryIndexProperty('Its new index in the stack; later entries paint on top.')
				},
				required: ['expectedRevision', 'overlayId', 'index'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.reorder-overlay', () =>
					runReorderCompositionOverlayOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						overlayId: readWebmcpStringArgument(args, 'overlayId'),
						index: readWebmcpNumberArgument(args, 'index')
					})
				)
		},
		{
			operationId: 'layer.add-annotation-mark',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					markStyle: webmcpDerivedEnumProperty(
						'annotation-style',
						'The mark style to author. The Surface content must already declare a span of it.'
					)
				},
				required: ['expectedRevision', 'markStyle'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.add-annotation-mark', () =>
					runAddCompositionAnnotationMarkOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						markStyle: readWebmcpLiteralArgument(args, 'markStyle', ANNOTATION_MARK_STYLES)
					})
				)
		},
		{
			operationId: 'layer.remove-annotation-mark',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					markIndex: entryIndexProperty(
						'The Mark to remove, by its index in document order. Its span returns to the Pack defaults.'
					)
				},
				required: ['expectedRevision', 'markIndex'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.remove-annotation-mark', () =>
					runRemoveCompositionAnnotationMarkOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						markIndex: readWebmcpNumberArgument(args, 'markIndex')
					})
				)
		},
		{
			operationId: 'layer.add-effect',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					effectType: webmcpDerivedEnumProperty(
						'effect-type',
						'The Effect to append to the post-process chain.'
					)
				},
				required: ['expectedRevision', 'effectType'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.add-effect', () =>
					runAddCompositionEffectOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						effectType: readWebmcpStringArgument(args, 'effectType')
					})
				)
		},
		{
			operationId: 'layer.remove-effect',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					effectId: webmcpEntityIdProperty('The Effect to remove from the chain.')
				},
				required: ['expectedRevision', 'effectId'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.remove-effect', () =>
					runRemoveCompositionEffectOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						effectId: readWebmcpStringArgument(args, 'effectId')
					})
				)
		},
		{
			operationId: 'layer.reorder-effect',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					effectId: webmcpEntityIdProperty('The Effect to move.'),
					index: entryIndexProperty('Its new index in the chain; later entries run last.')
				},
				required: ['expectedRevision', 'effectId', 'index'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.reorder-effect', () =>
					runReorderCompositionEffectOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						effectId: readWebmcpStringArgument(args, 'effectId'),
						index: readWebmcpNumberArgument(args, 'index')
					})
				)
		},
		{
			operationId: 'layer.add-text-animation',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					effect: webmcpDerivedEnumProperty(
						'text-effect',
						'The registered text effect to bind to the slot.'
					),
					target: textAnimationTargetProperty()
				},
				required: ['expectedRevision', 'effect', 'target'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.add-text-animation', () =>
					runAddCompositionTextAnimationOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						effect: readWebmcpStringArgument(args, 'effect'),
						target: readTextAnimationTarget(args)
					})
				)
		},
		{
			operationId: 'layer.remove-text-animation',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					textAnimationId: webmcpEntityIdProperty('The text animation to remove.')
				},
				required: ['expectedRevision', 'textAnimationId'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.remove-text-animation', () =>
					runRemoveCompositionTextAnimationOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						textAnimationId: readWebmcpStringArgument(args, 'textAnimationId')
					})
				)
		},
		{
			operationId: 'layer.add-diagram-primitive',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					primitiveType: webmcpDerivedEnumProperty(
						'diagram-primitive-type',
						'The diagram primitive to add to the Surface diagram group.'
					)
				},
				required: ['expectedRevision', 'primitiveType'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.add-diagram-primitive', () =>
					runAddCompositionDiagramPrimitiveOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						primitiveType: readWebmcpLiteralArgument(
							args,
							'primitiveType',
							DIAGRAM_PRIMITIVE_TYPES
						)
					})
				)
		},
		{
			operationId: 'layer.remove-diagram-primitive',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					blockId: webmcpEntityIdProperty('The diagram Block to remove.')
				},
				required: ['expectedRevision', 'blockId'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.remove-diagram-primitive', () =>
					runRemoveCompositionDiagramPrimitiveOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						blockId: readWebmcpStringArgument(args, 'blockId')
					})
				)
		},
		{
			operationId: 'layer.add-kinetic-word',
			inputSchema: {
				type: 'object',
				properties: { expectedRevision: webmcpObservedRevisionProperty() },
				required: ['expectedRevision'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.add-kinetic-word', () =>
					runAddCompositionKineticWordOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args)
					})
				)
		},
		{
			operationId: 'layer.remove-kinetic-word',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					wordId: webmcpEntityIdProperty('The Kinetic Word Block to remove.')
				},
				required: ['expectedRevision', 'wordId'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.remove-kinetic-word', () =>
					runRemoveCompositionKineticWordOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						wordId: readWebmcpStringArgument(args, 'wordId')
					})
				)
		},
		{
			operationId: 'layer.add-chart-block',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					chartType: webmcpDerivedEnumProperty(
						'chart-block-type',
						'The chart Block to add. The group plays as a sequence once it holds more than one.'
					)
				},
				required: ['expectedRevision', 'chartType'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.add-chart-block', () =>
					runAddCompositionChartBlockOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						chartType: readWebmcpLiteralArgument(args, 'chartType', ChartTypeSchema.options)
					})
				)
		},
		{
			operationId: 'layer.remove-chart-block',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					blockId: webmcpEntityIdProperty('The chart Block to remove from the group.')
				},
				required: ['expectedRevision', 'blockId'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.remove-chart-block', () =>
					runRemoveCompositionChartBlockOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						blockId: readWebmcpStringArgument(args, 'blockId')
					})
				)
		}
	];
}
