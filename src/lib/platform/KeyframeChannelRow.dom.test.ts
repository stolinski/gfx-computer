// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import type { Keyframe } from './engine-schema';
import KeyframeChannelRow from './KeyframeChannelRow.svelte';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';
import { keyframeSelection } from './selection.svelte';
import { createKeyframeSelectionId, createTimelineTrackId } from './timeline-entity-identity';
import { timelineHandle } from './timeline-handle.svelte';
import type { Timeline } from './timeline.svelte';

const TRACK_ROW_ID = createTimelineTrackId({ kind: 'overlay', overlayId: 'title' });

// A transport parked at `seconds`; `seek` moves it like the real one.
function parkPlayhead(seconds: number): { seek: ReturnType<typeof vi.fn> } {
	const transport = {
		time: seconds,
		seek: vi.fn((next: number) => {
			transport.time = next;
		})
	};
	timelineHandle.current = transport as unknown as Timeline;
	return transport;
}

function renderRow(track: readonly Keyframe[] | undefined, value = 0.5) {
	const onTrackChange = vi.fn();
	render(KeyframeChannelRow, {
		channel: 'opacity',
		label: 'opacity',
		bounds: { min: 0, max: 1 },
		track,
		clipStartMs: 0,
		value,
		trackRowId: TRACK_ROW_ID,
		onTrackChange
	});
	return onTrackChange;
}

describe('KeyframeChannelRow', () => {
	beforeEach(() => {
		applyPreset(parsePresetIngress(blankPresetJson));
		keyframeSelection.id = null;
	});

	it('adds a keyframe at the playhead from the shown value and selects it', async () => {
		parkPlayhead(0.5);
		const onTrackChange = renderRow([{ atMs: 0, value: 0 }], 0.4);

		await fireEvent.click(screen.getByRole('button', { name: 'Add opacity keyframe at playhead' }));

		expect(onTrackChange).toHaveBeenCalledWith([
			{ atMs: 0, value: 0 },
			{ atMs: 500, value: 0.4, ease: 'smooth' }
		]);
		expect(keyframeSelection.id).toBe(createKeyframeSelectionId(TRACK_ROW_ID, 'opacity', 1));
	});

	it('removes the keyframe under the playhead, clearing the channel with the last one', async () => {
		parkPlayhead(0);
		const onTrackChange = renderRow([{ atMs: 0, value: 1 }]);

		const toggle = screen.getByRole('button', { name: 'Remove opacity keyframe at playhead' });
		expect(toggle.getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(toggle);

		expect(onTrackChange).toHaveBeenCalledWith(null);
	});

	it('jumps the playhead to the previous and next keyframes', async () => {
		const transport = parkPlayhead(0.5);
		renderRow([
			{ atMs: 100, value: 0 },
			{ atMs: 900, value: 1, ease: 'smooth' }
		]);

		await fireEvent.click(screen.getByRole('button', { name: 'Next opacity keyframe' }));
		expect(transport.seek).toHaveBeenLastCalledWith(0.9);
		expect(keyframeSelection.id).toBe(createKeyframeSelectionId(TRACK_ROW_ID, 'opacity', 1));

		await fireEvent.click(screen.getByRole('button', { name: 'Previous opacity keyframe' }));
		expect(transport.seek).toHaveBeenLastCalledWith(0.1);
	});

	it('sets the ease into the keyframe under the playhead', async () => {
		parkPlayhead(0.9);
		const onTrackChange = renderRow([
			{ atMs: 100, value: 0 },
			{ atMs: 900, value: 1, ease: 'smooth' }
		]);

		await fireEvent.change(screen.getByRole('combobox', { name: 'opacity keyframe ease' }), {
			target: { value: 'sharp' }
		});

		expect(onTrackChange).toHaveBeenCalledWith([
			{ atMs: 100, value: 0 },
			{ atMs: 900, value: 1, ease: 'sharp' }
		]);
	});

	it('clamps a typed value into the bounds before writing it', async () => {
		parkPlayhead(0);
		const onTrackChange = renderRow([{ atMs: 0, value: 0.2 }]);

		await fireEvent.change(screen.getByRole('spinbutton', { name: 'opacity value at playhead' }), {
			target: { value: '4' }
		});

		expect(onTrackChange).toHaveBeenCalledWith([{ atMs: 0, value: 1 }]);
	});
});
