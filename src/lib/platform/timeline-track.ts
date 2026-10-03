/**
 * Timeline data model (ADR-0034 §2/§2a). One row per Layer; each row is a single
 * unified clip bar — `enter` ramp | solid | `exit` ramp — or a simple window clip
 * (stagger, roll, dwell …). Shared by the timeline-outline view and the
 * `buildCompositionTimelineTracks()` adapter that maps composition state onto it.
 */

import type {
	SoundRailReference,
	TimelineTrackId,
	VideoClipSelectionId
} from './timeline-entity-identity.ts';

export type TimelineTransitionRamp = 'in' | 'out';

/**
 * A Layer that maps onto the unified clip bar (ADR-0034 §2a). Carries the raw
 * schema scalars (used as drag origin + zone geometry) and the writers that
 * persist a dragged ramp back to the composition.
 */
export interface UnifiedClip {
	/** Enter ramp, composition-time fractions; absent for an exit-only clip. */
	enterStart?: number;
	enterDuration?: number;
	/** Exit ramp; absent for an enter-only clip. */
	exitStart?: number;
	exitDuration?: number;
	/** Where each ramp's ease lands (0–1) — handles sit at these perceived
	 *  boundaries, so the drag scales a duration delta by `1 / landFrac`. */
	enterLandFrac?: number;
	exitLandFrac?: number;
	/** Persist a dragged enter ramp back to the schema. */
	setEnter?: (start: number, duration: number) => void;
	/** Persist a dragged exit ramp back to the schema. */
	setExit?: (start: number, duration: number) => void;
}

/**
 * One authored keyframe rendered as a diamond marker on a channel-owned clip
 * (ADR-0035 §7). `fraction` is the keyframe's ABSOLUTE timeline position —
 * the view converts to bar-relative placement.
 */
export interface ClipKeyframe {
	channel: string;
	index: number;
	fraction: number;
	/** The keyframe's channel value — drawn by the automation sub-lane curve. */
	value: number;
}

/**
 * Cascade weld rendered as a tether from this clip's head to its anchor point
 * (ADR-0035 §4). `anchorTrackId` names the leader's row; `anchorFraction` is
 * the resolved anchor event (leader start or end) on the timeline.
 */
export interface ClipCascadeLink {
	anchorTrackId: TimelineTrackId;
	anchorFraction: number;
}

export interface TimelineTransition {
	id: string;
	label?: string;
	start: number;
	duration: number;
	color?: string;
	ramp?: TimelineTransitionRamp;
	minStart?: number;
	maxStart?: number;
	minDuration?: number;
	maxDuration?: number;
	/** Simple single-clip drag (window clips: stagger, roll, dwell …). */
	onUpdate?: (next: { start: number; duration: number }) => void;
	/** Enter-ramp width as a 0–1 fraction of the bar (unified bars only). */
	enterZone?: number;
	/** Exit-ramp width as a 0–1 fraction of the bar (unified bars only). */
	exitZone?: number;
	/**
	 * Fraction of the enter ramp at which its ease perceptibly lands (ADR-0034
	 * §2a) — the ramp fill is drawn solid by `enterZone * enterLandFrac`, not the
	 * full `enterZone`, so a front-loaded ease doesn't over-state the motion.
	 * Defaults to 1 (ramp = duration) when the layer's ease is unknown.
	 */
	enterLandFrac?: number;
	/** As {@link enterLandFrac}, for the exit ramp. */
	exitLandFrac?: number;
	/** Present when the row is a unified clip bar; drives the 5-handle drag. */
	unified?: UnifiedClip;
	/** Diamond markers for a channel-owned clip (ADR-0035). */
	keyframes?: ClipKeyframe[];
	/**
	 * Retime one keyframe: the view hands back the marker's dragged ABSOLUTE
	 * timeline fraction; the writer converts to atMs and clamps between its
	 * neighbours (strictly ascending stays true through any drag). `beatId`
	 * names the Motion Beat the drag snapped to, so a Kinetic Word key binds to
	 * it (ADR-0064); other keys only take its exact time.
	 */
	onKeyframeRetime?: (
		channel: string,
		index: number,
		fraction: number,
		beatId?: string | null
	) => void;
	/** Delete one keyframe (Delete/Backspace on the selected diamond). Empties
	 *  clean up: a drained track is removed, a new first keyframe drops its ease. */
	onKeyframeDelete?: (channel: string, index: number) => void;
	/** Present when this clip's enter is cascade-welded to another row. */
	cascade?: ClipCascadeLink;
	/** Present only for a cue on the Sound rail; routes selection without parsing the transition id. */
	soundReference?: SoundRailReference;
	/** Bundled audio-asset slug behind a manual cue clip — drives its waveform. */
	soundAssetSlug?: string;
}

export interface TimelineTrack {
	id: TimelineTrackId;
	label: string;
	color?: string;
	transitions: TimelineTransition[];
	onTrackMove?: (delta: number) => void;
	/**
	 * Rows that belong together (a Type Field's words) share a group: the
	 * Timeline draws one collapsible header above them.
	 */
	group?: { id: string; label: string };
}

/** One canonical Media clip represented on the fixed frame-valued Video row. */
export interface VideoTimelineClip {
	id: VideoClipSelectionId;
	clipId: string;
	assetId: string;
	label: string;
	timelineStartFrame: number;
	durationFrames: number;
	sourceStartSeconds: number;
	audio: {
		enabled: boolean;
		gain: number;
	};
}

/** The one fixed Video row beneath all five Layers. It is never removable. */
export interface VideoTimelineTrack extends TimelineTrack {
	kind: 'video';
	isRemovable: false;
	clips: VideoTimelineClip[];
	transitions: [];
}

export function isVideoTimelineTrack(track: TimelineTrack): track is VideoTimelineTrack {
	return 'kind' in track && track.kind === 'video';
}
