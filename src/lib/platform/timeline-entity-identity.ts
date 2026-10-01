/**
 * Runtime-only identity protocol for timeline rows and selections.
 *
 * Preset entity ids remain untouched. Dynamic segments are URI-encoded and
 * subtracks have their own discriminants, so an authored id such as
 * `closing-roll` can never be mistaken for a roll subtrack.
 */

declare const timelineTrackIdBrand: unique symbol;
declare const keyframeSelectionIdBrand: unique symbol;
declare const soundRailReferenceIdBrand: unique symbol;
declare const videoClipSelectionIdBrand: unique symbol;

export type TimelineTrackId = string & { readonly [timelineTrackIdBrand]: true };
export type KeyframeSelectionId = string & { readonly [keyframeSelectionIdBrand]: true };
export type SoundRailReferenceId = string & { readonly [soundRailReferenceIdBrand]: true };
export type VideoClipSelectionId = string & { readonly [videoClipSelectionIdBrand]: true };
export type TimelineEntitySelectionId =
	TimelineTrackId | SoundRailReferenceId | VideoClipSelectionId;

export type OverlayTimelineSubtrack =
	| { kind: 'stack' }
	| { kind: 'pile' }
	| { kind: 'roll' }
	| { kind: 'beat' }
	| { kind: 'spin' }
	| { kind: 'cursor'; index: number };

export type BlockTimelineSubtrack = { kind: 'roll' };

// The Layer rows, the Video and Sound rails, and the STAGE rows (ADR-0060):
// the camera, the focus, and one row per body on the Dimensional Stage. A
// body id names the body the Stage gave it (`screen` for `stage.screen`).
export type TimelineTrackIdentity =
	| { kind: 'surface' }
	| { kind: 'surface-message'; index: number }
	| { kind: 'checklist-item'; index: number }
	| { kind: 'mark'; index: number }
	| { kind: 'overlay'; overlayId: string }
	| { kind: 'overlay-subtrack'; overlayId: string; subtrack: OverlayTimelineSubtrack }
	| { kind: 'block'; blockId: string }
	| { kind: 'block-subtrack'; blockId: string; subtrack: BlockTimelineSubtrack }
	| { kind: 'text-animation'; textAnimationId: string }
	// A keyframed or welded Effect (ADR-0063): the row exists only while the
	// Effect carries a channel or a weld.
	| { kind: 'effect'; effectId: string }
	| { kind: 'captions' }
	| { kind: 'video' }
	| { kind: 'sound' }
	| { kind: 'stage-camera' }
	| { kind: 'stage-focus' }
	| { kind: 'stage-body'; bodyId: string };

/** The body id of the physical screen (`stage.screen`) on the timeline and the canvas. */
export const STAGE_SCREEN_BODY_ID = 'screen';

export type SoundRailReference =
	{ kind: 'derived'; cueId: string } | { kind: 'manual'; cueId: string };

export interface KeyframeSelectionIdentity {
	trackId: TimelineTrackId;
	channel: string;
	index: number;
}

export interface VideoClipSelectionIdentity {
	clipId: string;
}

function requireIdentitySegment(value: string, name: string): string {
	if (value.length === 0) {
		throw new TypeError(`Timeline entity identity: ${name} must not be empty.`);
	}
	return encodeURIComponent(value);
}

function requireIdentityIndex(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`Timeline entity identity: ${name} must be a non-negative safe integer.`);
	}
	return value;
}

function describeTrackIdentity(value: unknown): string {
	if (typeof value !== 'object' || value === null) return String(value);
	return 'kind' in value ? `kind ${String(value.kind)}` : 'an identity without a kind';
}

/**
 * Track identities cross a trust boundary here: the GUI, WebMCP focus moves,
 * and parsed ids all mint their row and canvas selection ids through
 * `createTimelineTrackId`, and the branded return type hides a missing value
 * from the compiler at every call site downstream.
 */
function requireTrackIdentity(value: unknown): void {
	if (typeof value !== 'object' || value === null || !('kind' in value)) {
		throw new TypeError(
			`Timeline entity identity: track identity must name a kind, received ${describeTrackIdentity(value)}.`
		);
	}
}

function decodeIdentitySegment(value: string): string | null {
	try {
		const decoded = decodeURIComponent(value);
		return decoded.length > 0 && encodeURIComponent(decoded) === value ? decoded : null;
	} catch {
		return null;
	}
}

function parseIdentityIndex(value: string): number | null {
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		return null;
	}
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

export function createTimelineTrackId(identity: TimelineTrackIdentity): TimelineTrackId {
	requireTrackIdentity(identity);
	switch (identity.kind) {
		case 'surface':
		case 'captions':
		case 'video':
		case 'sound':
		case 'stage-camera':
		case 'stage-focus':
			return identity.kind as TimelineTrackId;
		case 'stage-body':
			return `stage-body:${requireIdentitySegment(identity.bodyId, 'Stage body id')}` as TimelineTrackId;
		case 'surface-message':
			return `surface-message:${requireIdentityIndex(identity.index, 'Message index')}` as TimelineTrackId;
		case 'checklist-item':
			return `checklist-item:${requireIdentityIndex(identity.index, 'Checklist item index')}` as TimelineTrackId;
		case 'mark':
			return `mark:${requireIdentityIndex(identity.index, 'Mark index')}` as TimelineTrackId;
		case 'overlay':
			return `overlay:${requireIdentitySegment(identity.overlayId, 'Overlay id')}` as TimelineTrackId;
		case 'overlay-subtrack': {
			const base = `overlay-subtrack:${requireIdentitySegment(identity.overlayId, 'Overlay id')}`;
			return (
				identity.subtrack.kind === 'cursor'
					? `${base}:cursor:${requireIdentityIndex(identity.subtrack.index, 'Cursor index')}`
					: `${base}:${identity.subtrack.kind}`
			) as TimelineTrackId;
		}
		case 'block':
			return `block:${requireIdentitySegment(identity.blockId, 'Block id')}` as TimelineTrackId;
		case 'block-subtrack':
			return `block-subtrack:${requireIdentitySegment(identity.blockId, 'Block id')}:${identity.subtrack.kind}` as TimelineTrackId;
		case 'text-animation':
			return `text-animation:${requireIdentitySegment(identity.textAnimationId, 'Text animation id')}` as TimelineTrackId;
		case 'effect':
			return `effect:${requireIdentitySegment(identity.effectId, 'Effect id')}` as TimelineTrackId;
		default:
			throw new TypeError(
				`Timeline entity identity: unsupported track ${describeTrackIdentity(identity)}.`
			);
	}
}

export function parseTimelineTrackId(value: string): TimelineTrackIdentity | null {
	if (
		value === 'surface' ||
		value === 'captions' ||
		value === 'video' ||
		value === 'sound' ||
		value === 'stage-camera' ||
		value === 'stage-focus'
	) {
		return { kind: value };
	}

	const parts = value.split(':');
	const prefix = parts[0];
	if (parts.length === 2) {
		const index = parseIdentityIndex(parts[1]);
		if (prefix === 'surface-message' && index !== null) return { kind: 'surface-message', index };
		if (prefix === 'checklist-item' && index !== null) return { kind: 'checklist-item', index };
		if (prefix === 'mark' && index !== null) return { kind: 'mark', index };

		const entityId = decodeIdentitySegment(parts[1]);
		if (entityId === null) return null;
		if (prefix === 'overlay') return { kind: 'overlay', overlayId: entityId };
		if (prefix === 'block') return { kind: 'block', blockId: entityId };
		if (prefix === 'text-animation') {
			return { kind: 'text-animation', textAnimationId: entityId };
		}
		if (prefix === 'stage-body') return { kind: 'stage-body', bodyId: entityId };
		if (prefix === 'effect') return { kind: 'effect', effectId: entityId };
		return null;
	}

	if (prefix === 'overlay-subtrack' && (parts.length === 3 || parts.length === 4)) {
		const overlayId = decodeIdentitySegment(parts[1]);
		if (overlayId === null) return null;
		if (parts.length === 4 && parts[2] === 'cursor') {
			const index = parseIdentityIndex(parts[3]);
			return index === null
				? null
				: { kind: 'overlay-subtrack', overlayId, subtrack: { kind: 'cursor', index } };
		}
		if (
			parts.length === 3 &&
			(parts[2] === 'stack' ||
				parts[2] === 'pile' ||
				parts[2] === 'roll' ||
				parts[2] === 'beat' ||
				parts[2] === 'spin')
		) {
			return { kind: 'overlay-subtrack', overlayId, subtrack: { kind: parts[2] } };
		}
		return null;
	}

	if (prefix === 'block-subtrack' && parts.length === 3 && parts[2] === 'roll') {
		const blockId = decodeIdentitySegment(parts[1]);
		return blockId === null
			? null
			: { kind: 'block-subtrack', blockId, subtrack: { kind: 'roll' } };
	}

	return null;
}

export function createKeyframeSelectionId(
	trackId: TimelineTrackId,
	channel: string,
	index: number
): KeyframeSelectionId {
	return `keyframe:${encodeURIComponent(trackId)}:${requireIdentitySegment(channel, 'Keyframe channel')}:${requireIdentityIndex(index, 'Keyframe index')}` as KeyframeSelectionId;
}

export function parseKeyframeSelectionId(value: string): KeyframeSelectionIdentity | null {
	const parts = value.split(':');
	if (parts.length !== 4 || parts[0] !== 'keyframe') return null;
	const rawTrackId = decodeIdentitySegment(parts[1]);
	const channel = decodeIdentitySegment(parts[2]);
	const index = parseIdentityIndex(parts[3]);
	if (rawTrackId === null || channel === null || index === null) return null;
	if (parseTimelineTrackId(rawTrackId) === null) return null;
	return { trackId: rawTrackId as TimelineTrackId, channel, index };
}

export function createSoundRailReferenceId(reference: SoundRailReference): SoundRailReferenceId {
	return `sound-reference:${reference.kind}:${requireIdentitySegment(reference.cueId, 'Sound cue id')}` as SoundRailReferenceId;
}

export function parseSoundRailReferenceId(value: string): SoundRailReference | null {
	const parts = value.split(':');
	if (
		parts.length !== 3 ||
		parts[0] !== 'sound-reference' ||
		(parts[1] !== 'derived' && parts[1] !== 'manual')
	) {
		return null;
	}
	const cueId = decodeIdentitySegment(parts[2]);
	return cueId === null ? null : { kind: parts[1], cueId };
}

export function createVideoClipSelectionId(clipId: string): VideoClipSelectionId {
	return `video-clip:${requireIdentitySegment(clipId, 'Video clip id')}` as VideoClipSelectionId;
}

export function parseVideoClipSelectionId(value: string): VideoClipSelectionIdentity | null {
	const parts = value.split(':');
	if (parts.length !== 2 || parts[0] !== 'video-clip') return null;
	const clipId = decodeIdentitySegment(parts[1]);
	return clipId === null ? null : { clipId };
}
