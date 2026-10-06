/**
 * Figure WebMCP tools (ADR-0067 §7, ADR-0054). One tool per Figure operation
 * row, across the layer, content, placement, appearance, and motion families.
 * The nested declarations (a Figure, its data, layout, encoding, Moves, Pins)
 * are runtime objects whose exact fields the Figure schema validates inside the
 * operation's transaction, which answers a wrong shape with its exact path.
 */
import { COMPOSITION_PLACEMENT_TARGETS } from './composition-placement-operations';
import {
	runAddCompositionFigureOperation,
	runImportCompositionFigureDataOperation,
	runRemoveCompositionFigureOperation,
	runSetCompositionFigureDataOperation,
	runSetCompositionFigureEncodingOperation,
	runSetCompositionFigureFrameOperation,
	runSetCompositionFigureLayoutOperation,
	runSetCompositionFigureMovesOperation,
	runSetCompositionFigurePinsOperation
} from './composition-figure-operations';
import type { FigureKind } from './engine-schema';
import {
	readWebmcpDerivedEnums,
	webmcpDerivedEnumProperty,
	webmcpEntityIdProperty,
	webmcpFractionProperty,
	webmcpObservedRevisionProperty,
	webmcpRuntimeArrayOrJsonTextProperty,
	webmcpRuntimeObjectOrJsonTextProperty,
	type WebmcpSchemaProperty
} from './webmcp-derived-tool-schemas';
import {
	readWebmcpClearableRecordArgument,
	readWebmcpClearableStringArgument,
	readWebmcpLiteralArgument,
	readWebmcpObservedRevisionArgument,
	readWebmcpOptionalRuntimeJsonArgument,
	readWebmcpRuntimeJsonArgument,
	readWebmcpStringArgument,
	runWebmcpToolOperation,
	WebmcpArgumentError
} from './webmcp-tool-arguments';
import type { WebmcpToolDefinition } from './webmcp-tool-controller';

const FIGURE_IMPORT_FORMATS = ['csv', 'json'] as const;

function figureIdProperty(): WebmcpSchemaProperty {
	return webmcpEntityIdProperty('The Figure to write, by id.');
}

/** The frame rect, every field required, with `required` read from its own fields. */
function figureFrameRectProperty(): WebmcpSchemaProperty {
	const properties = {
		x: webmcpFractionProperty('Left edge, as a fraction of frame width.'),
		y: webmcpFractionProperty('Top edge, as a fraction of frame height.'),
		width: webmcpFractionProperty('Width, as a fraction of frame width.'),
		height: webmcpFractionProperty('Height, as a fraction of frame height.')
	};
	return {
		type: 'object',
		description: 'The frame rect, in frame fractions.',
		properties,
		required: Object.keys(properties),
		additionalProperties: false
	};
}

function figureTargetProperty(): WebmcpSchemaProperty {
	return {
		type: 'string',
		description:
			'Which value to write: the shared one both orientations fall back to, or one orientation’s complete override.',
		enum: COMPOSITION_PLACEMENT_TARGETS
	};
}

function readFigureArray(args: unknown, name: string): unknown[] {
	const value = readWebmcpRuntimeJsonArgument(args, name);
	if (!Array.isArray(value)) {
		throw new WebmcpArgumentError('invalid_argument', `"${name}" must be an array.`, {
			rejected: typeof value
		});
	}
	return value;
}

/** A required object-or-null argument: `null` clears, an object writes. */
function readRequiredClearableRecord(args: unknown, name: string): Record<string, unknown> | null {
	const record = readWebmcpClearableRecordArgument(args, name);
	if (record === undefined) {
		throw new WebmcpArgumentError(
			'invalid_argument',
			`"${name}" is required (an object or null).`,
			{
				rejected: 'undefined'
			}
		);
	}
	return record;
}

function readFigureKind(args: unknown): FigureKind | undefined {
	const kinds = readWebmcpDerivedEnums()['figure-kind'] as readonly FigureKind[];
	const record = args as Record<string, unknown> | null;
	if (record?.kind === undefined) return undefined;
	return readWebmcpLiteralArgument(args, 'kind', kinds);
}

export function listWebmcpFigureToolDefinitions(): readonly WebmcpToolDefinition[] {
	return [
		{
			operationId: 'layer.add-figure',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					kind: webmcpDerivedEnumProperty(
						'figure-kind',
						"Start from this kind's starter Figure. Send kind or figure, not both."
					),
					figure: webmcpRuntimeObjectOrJsonTextProperty(
						'A complete Figure declaration: type "figure", id, kind, data, layout, encoding, and Moves (exactly one reveal), with optional title, sourceNote, frame, layoutOrientationOverrides, and Pins.'
					)
				},
				required: ['expectedRevision'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.add-figure', () => {
					const kind = readFigureKind(args);
					const figure = readWebmcpOptionalRuntimeJsonArgument(args, 'figure');
					const expectedRevision = readWebmcpObservedRevisionArgument(args);
					if ((kind === undefined) === (figure === undefined)) {
						throw new WebmcpArgumentError(
							'invalid_argument',
							'Send exactly one of "kind" or "figure".',
							{ rejected: kind ?? 'neither', alternatives: ['kind', 'figure'] }
						);
					}
					return kind !== undefined
						? runAddCompositionFigureOperation({ expectedRevision, kind })
						: runAddCompositionFigureOperation({ expectedRevision, figure });
				})
		},
		{
			operationId: 'layer.remove-figure',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					figureId: figureIdProperty()
				},
				required: ['expectedRevision', 'figureId'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('layer.remove-figure', () =>
					runRemoveCompositionFigureOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						figureId: readWebmcpStringArgument(args, 'figureId')
					})
				)
		},
		{
			operationId: 'content.set-figure-data',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					figureId: figureIdProperty(),
					data: webmcpRuntimeObjectOrJsonTextProperty(
						"The whole data object in the Figure kind's shape (for example layers for a neural network, nodes and links for a Sankey, entities and frames for a bar race)."
					),
					title: {
						description: 'The title; null removes it; omit to leave it.',
						oneOf: [
							{ type: 'string', description: 'The title.', minLength: 1, maxLength: 120 },
							{ type: 'null', description: 'Remove the title.' }
						]
					},
					sourceNote: {
						description: 'The source note; null removes it; omit to leave it.',
						oneOf: [
							{ type: 'string', description: 'The source note.', minLength: 1, maxLength: 160 },
							{ type: 'null', description: 'Remove the source note.' }
						]
					}
				},
				required: ['expectedRevision', 'figureId', 'data'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('content.set-figure-data', () =>
					runSetCompositionFigureDataOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						figureId: readWebmcpStringArgument(args, 'figureId'),
						data: readWebmcpRuntimeJsonArgument(args, 'data'),
						title: readWebmcpClearableStringArgument(args, 'title'),
						sourceNote: readWebmcpClearableStringArgument(args, 'sourceNote')
					})
				)
		},
		{
			operationId: 'content.import-figure-data',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					figureId: figureIdProperty(),
					format: { type: 'string', description: 'The text format.', enum: FIGURE_IMPORT_FORMATS },
					text: {
						type: 'string',
						description:
							'The CSV (with a header row) or JSON text. CSV conventions: bar-race frame,entity…; line x,series…; slope entity,period…; sankey and network source,target[,value]; tree and treemap name,parent[,value]; cycle step[,detail]. A neural network imports JSON only.',
						minLength: 1,
						maxLength: 200_000
					}
				},
				required: ['expectedRevision', 'figureId', 'format', 'text'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('content.import-figure-data', () =>
					runImportCompositionFigureDataOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						figureId: readWebmcpStringArgument(args, 'figureId'),
						format: readWebmcpLiteralArgument(args, 'format', FIGURE_IMPORT_FORMATS),
						text: readWebmcpStringArgument(args, 'text')
					})
				)
		},
		{
			operationId: 'placement.set-figure-frame',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					figureId: figureIdProperty(),
					target: figureTargetProperty(),
					frame: {
						description:
							'The normalized frame rect the Figure lays itself out inside; null removes it (shared returns to the title-safe area, an orientation to the shared frame).',
						oneOf: [
							figureFrameRectProperty(),
							{ type: 'null', description: 'Remove this target frame.' }
						]
					}
				},
				required: ['expectedRevision', 'figureId', 'target', 'frame'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('placement.set-figure-frame', () =>
					runSetCompositionFigureFrameOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						figureId: readWebmcpStringArgument(args, 'figureId'),
						scope: readWebmcpLiteralArgument(args, 'target', COMPOSITION_PLACEMENT_TARGETS),
						frame: readRequiredClearableRecord(args, 'frame')
					})
				)
		},
		{
			operationId: 'placement.set-figure-layout',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					figureId: figureIdProperty(),
					target: figureTargetProperty(),
					layout: {
						description:
							"The complete layout object in the Figure kind's shape; null removes an orientation's override.",
						oneOf: [
							{
								type: 'object',
								description: 'The complete layout settings.',
								properties: {},
								additionalProperties: true
							},
							{ type: 'null', description: "Remove this orientation's override." }
						]
					}
				},
				required: ['expectedRevision', 'figureId', 'target', 'layout'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('placement.set-figure-layout', () =>
					runSetCompositionFigureLayoutOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						figureId: readWebmcpStringArgument(args, 'figureId'),
						scope: readWebmcpLiteralArgument(args, 'target', COMPOSITION_PLACEMENT_TARGETS),
						layout: readRequiredClearableRecord(args, 'layout')
					})
				)
		},
		{
			operationId: 'placement.set-figure-pins',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					figureId: figureIdProperty(),
					pins: webmcpRuntimeArrayOrJsonTextProperty(
						'Every Pin, replacing the current set. Each names a Mark id (node:<id>, link:<a>><b>, bar:<id>, line:<id>, series:<id>, threshold|band|event:<id>, label:<layer>) and may set position {x,y} in frame fractions (node Marks only), label, hidden, an orientation, and opacity/scale keyframe channels.'
					)
				},
				required: ['expectedRevision', 'figureId', 'pins'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('placement.set-figure-pins', () =>
					runSetCompositionFigurePinsOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						figureId: readWebmcpStringArgument(args, 'figureId'),
						pins: readFigureArray(args, 'pins')
					})
				)
		},
		{
			operationId: 'appearance.set-figure-encoding',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					figureId: figureIdProperty(),
					encoding: webmcpRuntimeObjectOrJsonTextProperty(
						"The complete encoding object in the Figure kind's shape (closed options such as nodeSize value|degree|uniform)."
					)
				},
				required: ['expectedRevision', 'figureId', 'encoding'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('appearance.set-figure-encoding', () =>
					runSetCompositionFigureEncodingOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						figureId: readWebmcpStringArgument(args, 'figureId'),
						encoding: readWebmcpRuntimeJsonArgument(args, 'encoding')
					})
				)
		},
		{
			operationId: 'motion.set-figure-moves',
			inputSchema: {
				type: 'object',
				properties: {
					expectedRevision: webmcpObservedRevisionProperty(),
					figureId: figureIdProperty(),
					moves: webmcpRuntimeArrayOrJsonTextProperty(
						`Every Move, replacing the current set. Each has move (${readWebmcpDerivedEnums()['figure-move'].join(', ')}), start and duration as composition fractions, an optional ease, and its own fields (reveal/exit style, propagate repeat and network path, pulse targets and repeat, flow cycles and targets, advance from/to, focus targets and treemap zoom, annotate targets).`
					)
				},
				required: ['expectedRevision', 'figureId', 'moves'],
				additionalProperties: false
			},
			run: (args) =>
				runWebmcpToolOperation('motion.set-figure-moves', () =>
					runSetCompositionFigureMovesOperation({
						expectedRevision: readWebmcpObservedRevisionArgument(args),
						figureId: readWebmcpStringArgument(args, 'figureId'),
						moves: readFigureArray(args, 'moves')
					})
				)
		}
	];
}
