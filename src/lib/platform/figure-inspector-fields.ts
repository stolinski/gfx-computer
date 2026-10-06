import { z } from 'zod';

import { FigureMoveSchema, FigureSchema, type FigureKind } from './engine-schema';

/**
 * Inspector fields for a Figure kind's layout and encoding, read off that kind's
 * own Zod schema (ADR-0067 §7). The GUI therefore offers exactly the options and
 * bounds the schema accepts, and a new kind or option reaches the inspector
 * without anyone restating it.
 */
export type FigureSettingsField =
	| { key: string; control: 'select'; options: readonly string[] }
	| { key: string; control: 'number'; min: number; max: number; step: number };

function figureKindShape(kind: FigureKind) {
	const option = FigureSchema.options.find((candidate) => candidate.shape.kind.value === kind);
	if (!option) throw new Error(`No Figure schema is registered for kind "${kind}".`);
	return option.shape;
}

function describeFigureSettingsObject(schema: z.ZodType): FigureSettingsField[] {
	if (!(schema instanceof z.ZodObject)) return [];
	const fields: FigureSettingsField[] = [];
	for (const [key, value] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
		if (value instanceof z.ZodEnum) {
			fields.push({ key, control: 'select', options: value.options as readonly string[] });
		} else if (value instanceof z.ZodNumber) {
			const min = value.minValue ?? 0;
			const max = value.maxValue ?? 1;
			fields.push({
				key,
				control: 'number',
				min,
				max: Math.min(max, 2_147_483_647),
				step: value.isInt ? 1 : 0.05
			});
		}
	}
	return fields;
}

/** The layout fields of one Figure kind. */
export function listFigureLayoutFields(kind: FigureKind): FigureSettingsField[] {
	return describeFigureSettingsObject(figureKindShape(kind).layout);
}

/** The encoding fields of one Figure kind. */
export function listFigureEncodingFields(kind: FigureKind): FigureSettingsField[] {
	return describeFigureSettingsObject(figureKindShape(kind).encoding);
}

/** Human labels for camelCase schema keys: `visibleCount` → `Visible count`. */
export function figureSettingsFieldLabel(key: string): string {
	const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The style options a reveal or exit Move accepts, read off the Move schema. */
export function listFigureMoveStyles(move: 'reveal' | 'exit'): readonly string[] {
	const option = FigureMoveSchema.options.find((candidate) => candidate.shape.move.value === move);
	return option && 'style' in option.shape ? (option.shape.style.options as readonly string[]) : [];
}
