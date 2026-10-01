// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionEditHistory } from './composition-edit-history';
import { compositionMeta } from './composition-meta.svelte';
import EffectParamRow from './EffectParamRow.svelte';
import type { Effect } from './engine-schema';
import { engineState, transitionState } from './engine-state.svelte';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';
import { timelineHandle } from './timeline-handle.svelte';
import type { Timeline } from './timeline.svelte';

function openWithEffects(effects: Effect[]): void {
	transitionState.capturing = false;
	applyPreset(
		parsePresetIngress({ ...blankPresetJson, state: { ...blankPresetJson.state, effects } })
	);
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
	timelineHandle.current = { time: 0.5, seek: () => undefined } as unknown as Timeline;
}

// A `.dom` test on purpose: only Svelte's browser build proxies `engineState`,
// and the row snapshots it before writing (the GFX-COMPUTER-X defect class).
describe('EffectParamRow', () => {
	beforeEach(() => {
		openWithEffects([{ type: 'pixelation', id: 'resolve', params: { pixelSize: 48 } }]);
	});

	it('edits the static param through one undoable operation while no track exists', async () => {
		render(EffectParamRow, {
			effect: engineState.effects[0],
			path: 'pixelSize',
			label: 'Pixel size'
		});

		await fireEvent.change(
			screen.getByRole('spinbutton', { name: 'Pixel size value at playhead' }),
			{
				target: { value: '12.4' }
			}
		);

		await waitFor(() => expect(engineState.effects[0].params).toEqual({ pixelSize: 12 }));
		expect(engineState.effects[0].animation).toBeUndefined();
		expect(compositionEditHistory.canUndo).toBe(true);
	});

	it('starts a track at the playhead, then edits the keyframe and leaves the static param alone', async () => {
		render(EffectParamRow, {
			effect: engineState.effects[0],
			path: 'pixelSize',
			label: 'Pixel size'
		});

		await fireEvent.click(
			screen.getByRole('button', { name: 'Add Pixel size keyframe at playhead' })
		);
		await waitFor(() =>
			expect(engineState.effects[0].animation?.channels?.pixelSize).toEqual([
				{ atMs: 500, value: 48 }
			])
		);

		await fireEvent.change(
			screen.getByRole('spinbutton', { name: 'Pixel size value at playhead' }),
			{
				target: { value: '96' }
			}
		);
		await waitFor(() =>
			expect(engineState.effects[0].animation?.channels?.pixelSize).toEqual([
				{ atMs: 500, value: 96 }
			])
		);
		expect(engineState.effects[0].params).toEqual({ pixelSize: 48 });
	});

	it('renders a frozen param as a plain row without the keyframe diamond', () => {
		openWithEffects([{ type: 'fluid-ripple', id: 'ripple', params: {} }]);
		render(EffectParamRow, { effect: engineState.effects[0], path: 'damping', label: 'Damping' });

		expect(screen.getByRole('spinbutton', { name: 'Damping value at playhead' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Add Damping keyframe at playhead' })).toBeNull();
	});

	it('offers the diamond on a live param of the same simulation Effect', () => {
		openWithEffects([{ type: 'fluid-ripple', id: 'ripple', params: {} }]);
		render(EffectParamRow, { effect: engineState.effects[0], path: 'radius', label: 'Radius' });

		expect(screen.getByRole('button', { name: 'Add Radius keyframe at playhead' })).toBeTruthy();
	});
});
