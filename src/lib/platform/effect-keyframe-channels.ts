/**
 * The keyframe channel vocabulary of an Effect (ADR-0063 §2–§4). Every numeric
 * leaf of the Effect's params schema is a channel, addressed by dotted path; a
 * definition may only subtract, through `frozenParams`. This module is the one
 * list the inspector, the timeline, semantic validation, and the WebMCP
 * vocabulary read — nothing restates a channel list per Effect.
 */
import { z } from 'zod';

import { isRecord, withDottedPathNumbers } from '$lib/utils/object';
import { listNumericLeafPaths, type ZodNumericLeaf } from '$lib/utils/zod-numeric-leaves';

import type { Effect } from './engine-schema';
import type { EffectPipelineDefinition } from './pipelines/definition-types';

/** One keyframeable Effect param: its dotted path under `params`, bounds, and integer flag. */
export interface EffectKeyframeChannel {
	path: string;
	min?: number;
	max?: number;
	/** Integer channels accept whole-number keyframes and round at sample time. */
	isInteger: boolean;
}

/** A channel finding, with its path relative to the Effect entry. */
export interface EffectKeyframeChannelIssue {
	path: (string | number)[];
	message: string;
}

interface EffectParamLeaves {
	channels: ReadonlyMap<string, ZodNumericLeaf>;
	frozen: ReadonlySet<string>;
}

// An Effect Pipeline declares the schema of its whole entry (`{ type, id,
// params }`), so the params leaves are the ones under this prefix.
const EFFECT_PARAMS_PATH_PREFIX = 'params.';

const effectParamLeavesByDefinition = new WeakMap<EffectPipelineDefinition, EffectParamLeaves>();

function readEffectParamLeaves(definition: EffectPipelineDefinition): EffectParamLeaves {
	const cached = effectParamLeavesByDefinition.get(definition);
	if (cached) return cached;

	if (!(definition.schema instanceof z.ZodType)) {
		throw new TypeError(
			`The ${definition.type} Effect schema is not a zod schema, so its keyframe channels cannot be derived.`
		);
	}
	const frozen = new Set(definition.frozenParams ?? []);
	const channels = new Map<string, ZodNumericLeaf>();
	for (const leaf of listNumericLeafPaths(definition.schema)) {
		if (!leaf.path.startsWith(EFFECT_PARAMS_PATH_PREFIX)) continue;
		const path = leaf.path.slice(EFFECT_PARAMS_PATH_PREFIX.length);
		if (frozen.has(path)) continue;
		channels.set(path, { ...leaf, path });
	}
	const leaves: EffectParamLeaves = { channels, frozen };
	effectParamLeavesByDefinition.set(definition, leaves);
	return leaves;
}

/** The Effect's keyframe channels in params declaration order, frozen params removed. */
export function listEffectKeyframeChannels(
	definition: EffectPipelineDefinition
): readonly EffectKeyframeChannel[] {
	return [...readEffectParamLeaves(definition).channels.values()].map(
		({ path, min, max, isInteger }) => {
			const channel: EffectKeyframeChannel = { path, isInteger };
			if (min !== undefined) channel.min = min;
			if (max !== undefined) channel.max = max;
			return channel;
		}
	);
}

function describeChannelRange(leaf: ZodNumericLeaf): string {
	return `${leaf.min ?? '-∞'}..${leaf.max ?? '∞'}`;
}

/**
 * The Effect's params with its schema defaults filled in, so a channel lands
 * in the same shape the Effect's renderer would otherwise default toward. An
 * entry the schema rejects keeps its authored params; semantic validation has
 * already reported it.
 */
function readEffectParamsWithDefaults(
	effect: Pick<Effect, 'type' | 'id' | 'params'>,
	definition: EffectPipelineDefinition
): unknown {
	const parsed = definition.schema.safeParse({
		type: effect.type,
		id: effect.id,
		params: effect.params
	});
	return parsed.success && isRecord(parsed.data) ? parsed.data.params : effect.params;
}

// The first object on a dotted path that is absent from `params`, by its
// dotted name, or null when every parent exists.
function findMissingParamParent(params: unknown, channelPath: string): string | null {
	const keys = channelPath.split('.');
	let current: unknown = params;
	for (let index = 0; index < keys.length - 1; index += 1) {
		const next: unknown = isRecord(current) ? current[keys[index]] : undefined;
		if (!isRecord(next)) return keys.slice(0, index + 1).join('.');
		current = next;
	}
	return null;
}

/**
 * The params one frame renders with (ADR-0063 §5): the authored params with
 * schema defaults filled in, and each driven channel set at its dotted path.
 * Integer channels round here, at sample time. `values` comes from the
 * animation manifest; this function never samples a track itself.
 */
export function resolveEffectParamsWithChannelValues(
	effect: Pick<Effect, 'type' | 'id' | 'params'>,
	definition: EffectPipelineDefinition,
	values: Readonly<Record<string, number>>
): unknown {
	const base = readEffectParamsWithDefaults(effect, definition);
	if (!isRecord(base)) return effect.params;
	const { channels } = readEffectParamLeaves(definition);
	const driven: Record<string, number> = {};
	for (const [path, value] of Object.entries(values)) {
		const leaf = channels.get(path);
		if (!leaf) continue;
		driven[path] = leaf.isInteger ? Math.round(value) : value;
	}
	return withDottedPathNumbers(base, driven);
}

/**
 * Checks an Effect's declared channels against its definition: an unknown or
 * frozen channel path, a value outside the leaf's bounds, and a fractional
 * value on an integer channel are each reported at their exact path.
 */
export function validateEffectKeyframeChannels(
	effect: Pick<Effect, 'type' | 'id' | 'params' | 'animation'>,
	definition: EffectPipelineDefinition
): EffectKeyframeChannelIssue[] {
	const declared = effect.animation?.channels;
	if (!declared) return [];

	const { channels, frozen } = readEffectParamLeaves(definition);
	const resolvedParams = readEffectParamsWithDefaults(effect, definition);
	const issues: EffectKeyframeChannelIssue[] = [];
	for (const [channelPath, track] of Object.entries(declared)) {
		const path = ['animation', 'channels', channelPath];
		if (frozen.has(channelPath)) {
			issues.push({
				path,
				message: `"${channelPath}" is frozen on the ${definition.type} Effect: it seeds a simulation or a hash, so it cannot change over time. Set it in params instead.`
			});
			continue;
		}
		const leaf = channels.get(channelPath);
		if (!leaf) {
			const known = [...channels.keys()];
			issues.push({
				path,
				message: `"${channelPath}" is not a keyframe channel of the ${definition.type} Effect. Channels: ${known.length > 0 ? known.join(', ') : 'none'}.`
			});
			continue;
		}
		const missingParent = findMissingParamParent(resolvedParams, channelPath);
		if (missingParent) {
			issues.push({
				path,
				message: `"${channelPath}" needs a ${missingParent} block in params before it can be animated.`
			});
			continue;
		}
		track.forEach((frame, index) => {
			if (leaf.isInteger && !Number.isInteger(frame.value)) {
				issues.push({
					path: [...path, index, 'value'],
					message: `${channelPath} is an integer channel; keyframe value ${frame.value} is not a whole number.`
				});
			} else if (!leaf.schema.safeParse(frame.value).success) {
				issues.push({
					path: [...path, index, 'value'],
					message: `Keyframe value ${frame.value} is outside the ${channelPath} channel's range ${describeChannelRange(leaf)}.`
				});
			}
		});
	}
	return issues;
}
