// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { engineState } from './engine-state.svelte';
import OrientationCustomizeToggle from './OrientationCustomizeToggle.svelte';

describe('OrientationCustomizeToggle', () => {
	afterEach(() => {
		engineState.transport.orientation = 'horizontal';
	});

	it('names the active orientation and reports the next state', async () => {
		engineState.transport.orientation = 'vertical';
		const onchange = vi.fn();
		render(OrientationCustomizeToggle, { customized: false, onchange });

		const toggle = screen.getByRole('switch', { name: 'Customize vertical' });
		expect(toggle.getAttribute('aria-checked')).toBe('false');
		await fireEvent.click(toggle);
		expect(onchange).toHaveBeenCalledWith(true);
	});

	it('turns a customized orientation off', async () => {
		const onchange = vi.fn();
		render(OrientationCustomizeToggle, { customized: true, onchange });

		const toggle = screen.getByRole('switch', { name: 'Customize horizontal' });
		expect(toggle.getAttribute('aria-checked')).toBe('true');
		await fireEvent.click(toggle);
		expect(onchange).toHaveBeenCalledWith(false);
	});
});
