import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { beforeAll, describe, it } from 'vitest';

const COMPONENT_FILES = {
	rootInspector: 'RootInspector.svelte',
	transitionRecipeSection: 'TransitionRecipeSection.svelte',
	depthStageSection: 'DepthStageSection.svelte',
	videoClipInspector: 'VideoClipInspector.svelte',
	inspector: 'Inspector.svelte',
	mediaInspector: 'MediaInspector.svelte',
	timelineOutline: 'TimelineOutline.svelte',
	timelineAddMenu: 'TimelineAddMenu.svelte',
	videoTimelineTrack: 'VideoTimelineTrack.svelte'
} as const;

type ComponentSource = Record<keyof typeof COMPONENT_FILES, string>;

let source: ComponentSource;

beforeAll(async () => {
	source = Object.fromEntries(
		await Promise.all(
			Object.entries(COMPONENT_FILES).map(async ([key, filename]) => [
				key,
				await readFile(new URL(filename, import.meta.url), 'utf8')
			])
		)
	) as ComponentSource;
});

function assertIncludes(haystack: string, needle: string, message: string): void {
	assert.ok(haystack.includes(needle), message);
}

function assertExcludes(haystack: string, needle: string, message: string): void {
	assert.ok(!haystack.includes(needle), message);
}

describe('media right rail source contract', () => {
	it('keeps composition transport and canonical Video clip guards in RootInspector', () => {
		assertIncludes(
			source.rootInspector,
			'label="Transport"',
			'RootInspector must retain the composition Transport section'
		);
		assertIncludes(
			source.rootInspector,
			'<Field label="Duration">',
			'RootInspector Transport must retain composition Duration'
		);
		assertIncludes(
			source.rootInspector,
			'<Field label="Rate">',
			'RootInspector Transport must retain composition Rate'
		);
		// The incompatible-with-Video-clips controls each carry the canonical
		// guard in the section component that owns them: Background fill in
		// RootInspector, the Transition recipe and Depth stage in their sections.
		for (const [key, label] of [
			['rootInspector', 'Background fill'],
			['transitionRecipeSection', 'Transition recipe'],
			['depthStageSection', 'Depth stage']
		] as const) {
			assertIncludes(
				source[key],
				'engineState.media.videoTrack.clips.length > 0',
				`${label} must retain the canonical active Video clip guard for incompatible composition controls`
			);
		}
	});

	it('limits VideoClipInspector to clip identity, audio, gain, and removal', () => {
		for (const label of [
			'<Field label="Name">',
			'<Field label="Identity">',
			'<Field label="Audio">',
			'<Field label="Gain">'
		]) {
			assertIncludes(
				source.videoClipInspector,
				label,
				`VideoClipInspector must expose the ${label.match(/"([^"]+)"/)?.[1] ?? label} contract`
			);
		}
		assertIncludes(
			source.videoClipInspector,
			'setSelectedVideoClipAudioEnabled',
			'VideoClipInspector must write clip audio enabled state through the media API'
		);
		assertIncludes(
			source.videoClipInspector,
			'setSelectedVideoClipAudioGain',
			'VideoClipInspector must write clip gain through the media API'
		);
		assertIncludes(
			source.videoClipInspector,
			'removeSelectedVideoClip',
			'VideoClipInspector must remove clips through the safe media API'
		);
		assertIncludes(
			source.videoClipInspector,
			'type="range"',
			'VideoClipInspector gain must remain a range control'
		);

		for (const temporalField of ['timelineStartFrame', 'durationFrames', 'sourceStartSeconds']) {
			assertExcludes(
				source.videoClipInspector,
				temporalField,
				`VideoClipInspector must not expose temporal field ${temporalField}`
			);
		}
		assertExcludes(
			source.videoClipInspector,
			'type="number"',
			'VideoClipInspector must not expose numeric clip authoring inputs'
		);
	});

	it('dispatches accessible Inspector and Media rail modes and Video clip selection', () => {
		assertIncludes(
			source.inspector,
			'<nav class="inspector__modes" aria-label="Inspector mode">',
			'Inspector rail modes must be grouped in an accessible labelled nav'
		);
		assert.ok(
			source.inspector.split('aria-pressed=').length - 1 >= 2,
			'Inspector and Media mode controls must both expose aria-pressed state'
		);
		assertIncludes(
			source.inspector,
			"inspectorRailMode.mode === 'media'",
			'Inspector must dispatch the Media rail mode'
		);
		assertIncludes(
			source.inspector,
			'<MediaInspector />',
			'Inspector must render MediaInspector in Media mode'
		);
		assertIncludes(
			source.inspector,
			"resolved.kind === 'video-clip'",
			'Inspector must dispatch canonical Video clip selections'
		);
		assertIncludes(
			source.inspector,
			'<VideoClipInspector clipId={resolved.clipId} />',
			'Inspector must pass the selected clip identity to VideoClipInspector'
		);
	});

	it('keeps drop-only multi-file import, errors, Timeline drag transfer, and safe removal', () => {
		assertExcludes(
			source.mediaInspector,
			'type="file"',
			'MediaInspector must not expose a browser file upload control'
		);
		for (const eventHandler of [
			'ondragenter={handleDragEnter}',
			'ondragover={handleDragOver}',
			'ondragleave={handleDragLeave}',
			'ondrop={handleDrop}'
		]) {
			assertIncludes(
				source.mediaInspector,
				eventHandler,
				`MediaInspector must keep its whole-library drop handler ${eventHandler}`
			);
		}
		assertIncludes(
			source.mediaInspector,
			"Array.from(event.dataTransfer?.files ?? [])",
			'Media drop import must retain every dropped file'
		);
		for (const formatLabel of ['MP4', 'MOV', 'WEBM']) {
			assertIncludes(
				source.mediaInspector,
				formatLabel,
				`Media drop affordance must identify ${formatLabel} support`
			);
		}
		assertIncludes(
			source.mediaInspector,
			'role="alert"',
			'Media import errors must be announced with role=alert'
		);
		assertIncludes(
			source.mediaInspector,
			'finally {',
			'Media multi-file import must clear progress through a finally path'
		);
		assertIncludes(source.mediaInspector, 'draggable="true"', 'Media assets must remain draggable');
		assertIncludes(
			source.mediaInspector,
			'writeMediaLibraryAssetDragTransfer(event.dataTransfer, assetId)',
			'Media drag start must use the typed media-library transfer writer'
		);
		assertIncludes(
			source.mediaInspector,
			'removeCompositionMediaAsset(engineState.media, assetId)',
			'Media removal must use the safe composition media removal function'
		);
		assertIncludes(
			source.mediaInspector,
			"result.status === 'removed'",
			'Media removal cleanup must only run after confirmed removal'
		);
	});

	it('keeps Media and Video authoring out of the Timeline Add layer menu', () => {
		const menuStart = source.timelineAddMenu.indexOf('id="timeline-add-menu"');
		assert.notEqual(menuStart, -1, 'TimelineAddMenu must retain the canonical Add layer menu');
		const menuEnd = source.timelineAddMenu.indexOf('</footer>', menuStart);
		assert.notEqual(menuEnd, -1, 'Timeline Add layer menu must remain bounded by its footer');
		const addMenuMarkup = source.timelineAddMenu.slice(menuStart, menuEnd);

		for (const forbidden of [
			'>Media<',
			'>Video<',
			'pickMedia',
			'pickVideo',
			'type="file"',
			'ondrag',
			'DataTransfer',
			'writeMediaLibraryAssetDragTransfer',
			'uploadUserVideo'
		]) {
			assertExcludes(
				addMenuMarkup,
				forbidden,
				`Timeline Add layer menu must not contain Media/Video authoring wiring: ${forbidden}`
			);
		}
	});

	it('wires the fixed Video row to accessible direct timeline authoring', () => {
		assertIncludes(
			source.timelineOutline,
			'<VideoTimelineTrack track={row.track} {timeline} />',
			'TimelineOutline must delegate the fixed Video row to its focused component'
		);
		assertIncludes(
			source.timelineOutline,
			"target?.closest('.track-transition, [data-video-timeline-clip]')",
			'Video clip gestures must not fall through to timeline seeking'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'#33363e',
			'Video clips must use the neutral filmstrip slab, not a layer-kind color'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'0 0 0 1.5px #2de8ee',
			'Selected Video clips must use the transport-cyan selection ring'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'aria-label={`Move ${clip.label} video clip. Hold Alt or Option to slip source.`}',
			'Video clip interiors must expose an accessible direct-manipulation name'
		);
		assert.ok(
			source.videoTimelineTrack.split('type="button"').length - 1 >= 3,
			'Video clips must expose accessible interior and trim handle buttons'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'selectVideoClip(clip.clipId)',
			'Existing Video clip selection must use the canonical selection API'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'inspectorRailMode.switchToInspector()',
			'Video clip selection must restore Inspector rail mode'
		);
		const pointerUpHandler = source.videoTimelineTrack.match(
			/function handlePointerUp[\s\S]*?\n\t}/
		)?.[0];
		assert.ok(pointerUpHandler, 'Video Timeline must handle pointer completion');
		assertIncludes(
			pointerUpHandler,
			'finishPointerDrag(false)',
			'Video clip pointer completion must commit the last valid position'
		);
		const pointerCancelHandler = source.videoTimelineTrack.match(
			/function handlePointerCancel[\s\S]*?\n\t}/
		)?.[0];
		assert.ok(pointerCancelHandler, 'Video Timeline must handle pointer cancellation');
		assertIncludes(
			pointerCancelHandler,
			'finishPointerDrag(true)',
			'Video clip pointer cancellation must roll back to the immutable drag origin'
		);
		const pointerMoveHandler = source.videoTimelineTrack.match(
			/function handlePointerMove[\s\S]*?\n\t}/
		)?.[0];
		assert.ok(pointerMoveHandler, 'Video Timeline must handle pointer movement');
		assertIncludes(
			pointerMoveHandler,
			'event.buttons === 0',
			'Video Timeline must close a gesture whose release occurred outside the document'
		);
		assertIncludes(
			pointerMoveHandler,
			'finishPointerDrag(false)',
			'A released out-of-document Video drag must keep its last valid position'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'if (pointerDrag) finishPointerDrag(false)',
			'A new Video drag must commit any stale capture-loss gesture rather than snap it back'
		);
		assertIncludes(
			source.videoTimelineTrack,
			"event.altKey ? 'slip' : 'move'",
			'Alt or Option must lock slip mode at pointer origin'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'originMedia: Media',
			'Video gestures must retain the originating composition Media identity'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'engineState.media !== state.originMedia',
			'Video pointer movement must stop before writing after a composition switch'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'engineState.media === state.originMedia',
			'Video commit and rollback cleanup must verify the originating Media identity'
		);
		assertExcludes(
			source.videoTimelineTrack,
			'onlostpointercapture',
			'Lost pointer capture must not terminate a Video drag that is still tracked on window'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'$effect',
			'Video timeline must react to clips and assets added after mount'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'untrack(() => {',
			'Video timeline media probing must not subscribe to inspection cache updates'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'.filter((asset) => referencedAssetIds.has(asset.id))',
			'Video timeline media probing must remain scoped to assets referenced by visible clips'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'const assetUrls = new Set(',
			'Video timeline media probing must deduplicate referenced asset URLs'
		);
		assertIncludes(
			source.videoTimelineTrack,
			"inspection.status !== 'ready' && mode !== 'move'",
			'Plain Video clip movement must not wait for volatile source metadata'
		);
		assertIncludes(
			source.videoTimelineTrack,
			'framesToSeconds(canonicalClip.durationFrames, frameRate)',
			'Pre-probe movement must validate against the clip source range already in use'
		);
	});
});
