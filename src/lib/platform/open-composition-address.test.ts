import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import {
	discardOpenCompositionArrival,
	installOpenCompositionAddressNavigator,
	isOpenCompositionArrivingAt,
	moveToOpenCompositionAddress,
	takeOpenCompositionArrival,
	type OpenCompositionAddress
} from './open-composition-address';

let removeNavigator: (() => void) | null = null;

function installNavigator(
	navigate: (address: OpenCompositionAddress) => Promise<void> = async () => undefined
): ReturnType<typeof vi.fn<(address: OpenCompositionAddress) => Promise<void>>> {
	const navigator = vi.fn(navigate);
	removeNavigator = installOpenCompositionAddressNavigator(navigator);
	return navigator;
}

afterEach(() => {
	removeNavigator?.();
	removeNavigator = null;
	discardOpenCompositionArrival();
	vi.restoreAllMocks();
});

describe('the open composition address', () => {
	it('does nothing where no shell installed a navigator', async () => {
		await moveToOpenCompositionAddress({ slug: 'untitled' });

		expect(isOpenCompositionArrivingAt('untitled')).toBe(false);
		expect(takeOpenCompositionArrival('untitled')).toBe(false);
	});

	it('asks the one navigator for the address, once', async () => {
		const navigator = installNavigator();

		await moveToOpenCompositionAddress({ slug: 'untitled' });

		expect(navigator).toHaveBeenCalledTimes(1);
		expect(navigator).toHaveBeenCalledWith({ slug: 'untitled' });
	});

	it('lets the route take the arrival exactly once, and only at that slug', async () => {
		const seenWhileNavigating: boolean[] = [];
		installNavigator(async ({ slug }) => {
			// What the preset route reads once the URL has changed.
			seenWhileNavigating.push(isOpenCompositionArrivingAt(slug));
		});

		await moveToOpenCompositionAddress({ slug: 'untitled' });

		expect(seenWhileNavigating).toEqual([true]);
		expect(takeOpenCompositionArrival('untitled')).toBe(true);
		// A later visit to the same slug is an ordinary navigation: it loads.
		expect(takeOpenCompositionArrival('untitled')).toBe(false);
		expect(isOpenCompositionArrivingAt('untitled')).toBe(false);

		await moveToOpenCompositionAddress({ slug: 'untitled-2' });
		// Arriving somewhere else forgets the move rather than keeping it for later.
		expect(takeOpenCompositionArrival('lower-third')).toBe(false);
		expect(takeOpenCompositionArrival('untitled-2')).toBe(false);
	});

	it('forgets an arrival nothing took when the route goes away', async () => {
		installNavigator();
		await moveToOpenCompositionAddress({ slug: 'untitled' });

		discardOpenCompositionArrival();

		expect(takeOpenCompositionArrival('untitled')).toBe(false);
	});

	it('logs a navigation that failed and leaves no arrival behind', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		installNavigator(async () => {
			throw new Error('navigation cancelled');
		});

		await expect(moveToOpenCompositionAddress({ slug: 'untitled' })).resolves.toBeUndefined();

		expect(logged).toHaveBeenCalledTimes(1);
		expect(takeOpenCompositionArrival('untitled')).toBe(false);
	});

	it('removes only the navigator it installed', async () => {
		const first = installNavigator();
		const removeFirst = removeNavigator;
		const second = installNavigator();

		removeFirst?.();
		await moveToOpenCompositionAddress({ slug: 'untitled' });

		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});
});
