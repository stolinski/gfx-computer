import { resolveOverlayPlacement } from '$lib/utils/overlay-placement';

import type { Cascade, EngineState, Keyframe } from './engine-schema';

function trackKeyframeChannels(
	channels: Partial<Record<string, readonly Keyframe[] | undefined>> | undefined
): void {
	if (!channels) return;
	for (const track of Object.values(channels)) {
		if (!track) continue;
		void track.length;
		for (const frame of track) {
			void frame.atMs;
			void frame.value;
			void frame.ease;
		}
	}
}

function trackCascade(cascade: Cascade | undefined): void {
	if (!cascade) return;
	void cascade.event;
	void cascade.offsetMs;
	const anchor = cascade.anchor;
	if (typeof anchor === 'string') return;
	if ('overlay' in anchor) void anchor.overlay;
	else if ('mark' in anchor) void anchor.mark;
	else if ('block' in anchor) void anchor.block;
	else void anchor.textAnimation;
}

/**
 * Synchronously reads every authored value that can change the animation manifest
 * or rendered pixels. Calling this inside a Svelte effect makes those reads the
 * effect's dependencies; it must remain synchronous and must not snapshot state.
 */
export function trackCompositionAuthoringDependencies(state: EngineState, packSlug: string): void {
	void state.transport.durationSeconds;
	const activeOrientation = state.transport.orientation;

	void state.textAnimations.length;
	for (const entry of state.textAnimations) {
		void entry.id;
		void entry.effect;
		void entry.target;
		void entry.enter.start;
		void entry.enter.duration;
		void entry.exit?.start;
		void entry.exit?.duration;
		trackCascade(entry.cascade);
	}

	void state.surface.enter?.start;
	void state.surface.enter?.duration;
	void state.surface.enter?.ease;
	void state.surface.exit?.start;
	void state.surface.exit?.duration;
	void state.surface.exit?.ease;
	trackKeyframeChannels(state.surface.animation?.channels);

	void state.surface.content.title;
	void state.surface.content.kicker;
	void state.surface.content.sourceUrl;
	void state.surface.content.author;
	void state.surface.content.affiliation;
	void state.surface.content.avatarUrl;
	void state.surface.content.source;
	void state.surface.content.dateLabel;
	void state.surface.content.bodyLabel;
	void state.surface.content.body;
	void state.surface.content.counterpoint;
	void state.surface.content.imageUrl;
	void state.surface.content.logoUrl;
	for (const item of state.surface.content.items ?? []) void JSON.stringify(item);
	for (const message of state.surface.content.messages ?? []) void JSON.stringify(message);
	void state.surface.variant;
	void state.typography.fontFamily;
	void state.typography.paperColor;
	void state.typography.inkColor;

	void state.overlays.length;
	for (const overlay of state.overlays) {
		void overlay.id;
		void overlay.type;
		void overlay.content;
		void overlay.position.orientationOverrides?.[activeOrientation];
		const placement = resolveOverlayPlacement(overlay.position, activeOrientation);
		void placement.anchor;
		void placement.offset?.x;
		void placement.offset?.y;
		void placement.rect?.x;
		void placement.rect?.y;
		void placement.rect?.width;
		void placement.rect?.height;
		void placement.scale;
		void placement.rotation;
		void overlay.enter?.start;
		void overlay.enter?.duration;
		void overlay.enter?.ease;
		void overlay.exit?.start;
		void overlay.exit?.duration;
		void overlay.exit?.ease;
		trackKeyframeChannels(overlay.animation?.channels);
		trackCascade(overlay.animation?.cascade);
	}

	void state.surface.diagram?.length;
	for (const primitive of state.surface.diagram ?? []) void JSON.stringify(primitive);
	void state.surface.chart?.mode;
	void state.surface.chart?.items.length;
	for (const chartItem of state.surface.chart?.items ?? []) void JSON.stringify(chartItem);
	// Type Field content, placement, and independent word channels all affect the
	// native DOM capture and animation manifest.
	if (state.surface.typeField) void JSON.stringify(state.surface.typeField);

	void state.marks.timings.length;
	for (const timing of state.marks.timings) {
		void timing.start;
		void timing.duration;
		void timing.color;
		void timing.intensity;
		trackCascade(timing.cascade);
	}
	for (const appearance of Object.values(state.marks.defaults)) {
		void appearance?.color;
		void appearance?.intensity;
	}

	void state.effects.length;
	for (const entry of state.effects) {
		void entry.type;
		if (entry.params && typeof entry.params === 'object') void JSON.stringify(entry.params);
	}
	void state.backgroundFill;
	void JSON.stringify(state.media);
	if (state.captions) void JSON.stringify(state.captions);

	// Stage camera, focus, pull, backdrop asset, and contrast all affect a live frame.
	// Deep-reading also makes future registered Stage fields reactive by default.
	void state.stage;
	if (state.stage) void JSON.stringify(state.stage);
	void packSlug;
}
