<script lang="ts">
	import type { TimelineTrack } from './timeline-track';

	// Cascade tethers (ADR-0035 §4): a welded clip draws a dashed elbow from its
	// head back to the anchor event on the leader's row. The outline owns the
	// row geometry (sub-lanes make row offsets non-uniform), so y positions come
	// in as real row-centre pixels; x coordinates are lane-width percentages.
	interface Props {
		tracks: TimelineTrack[];
		/** Row-centre pixel offset per track id, prefix-summed over real row heights. */
		rowCenterY: ReadonlyMap<string, number>;
		/** Total rows-content height in pixels, so the overlay spans every lane. */
		contentBlockSize: number;
	}

	let { tracks, rowCenterY, contentBlockSize }: Props = $props();

	interface CascadeTether {
		key: string;
		anchorX: number;
		anchorY: number;
		followerX: number;
		followerY: number;
	}

	const cascadeTethers = $derived.by(() => {
		const tethers: CascadeTether[] = [];
		for (const track of tracks) {
			const followerY = rowCenterY.get(track.id);
			if (followerY === undefined) continue;
			for (const transition of track.transitions) {
				const link = transition.cascade;
				if (!link) {
					continue;
				}
				const anchorY = rowCenterY.get(link.anchorTrackId);
				if (anchorY === undefined) {
					continue;
				}
				tethers.push({
					key: `${track.id}:${transition.id}`,
					anchorX: link.anchorFraction * 100,
					anchorY,
					followerX: transition.start * 100,
					followerY
				});
			}
		}
		return tethers;
	});
</script>

{#if cascadeTethers.length > 0}
	<!-- Scrolls with the lanes; x is a lane-width percentage, y a row-centre pixel. -->
	<svg class="track-tethers" style:block-size="{contentBlockSize}px" aria-hidden="true">
		{#each cascadeTethers as tether (tether.key)}
			<line x1="{tether.anchorX}%" y1={tether.anchorY} x2="{tether.anchorX}%" y2={tether.followerY} />
			<line
				x1="{tether.anchorX}%"
				y1={tether.followerY}
				x2="{tether.followerX}%"
				y2={tether.followerY}
			/>
			<circle cx="{tether.anchorX}%" cy={tether.anchorY} r="2.5" />
		{/each}
	</svg>
{/if}

<style>
	/* Spans the full-bleed lane content so x-percentages match clip fractions;
	   scrolls with the rows; never intercepts drags. */
	.track-tethers {
		inline-size: 100%;
		inset-block-start: 0;
		inset-inline: 0;
		overflow: visible;
		pointer-events: none;
		position: absolute;
	}

	.track-tethers line {
		stroke: var(--chrome-muted);
		stroke-dasharray: 3 3;
		stroke-width: 1;
	}

	.track-tethers circle {
		fill: #2de8ee;
	}
</style>
