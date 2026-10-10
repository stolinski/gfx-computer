/**
 * What has to happen after a whole composition state is written into engine
 * state before the canvas shows it at one moment of its own time.
 *
 * Every swap of a whole Scene goes through `./film-scene-selection.ts`: a
 * Scene selection, which makes another Scene of the open Film live and leaves
 * it there, and the hold an export or a boundary window frame opens, which
 * shows a Scene to render it and gives the author's Scene back. All of them
 * settle through this one sequence, so a swapped-in state is ready by the same
 * rule whoever swapped it.
 */
export interface CompositionStateSwapSettleDependencies {
	flushDom(): Promise<void>;
	waitForFonts(): Promise<void>;
	waitForLayout(): Promise<void>;
	/**
	 * Rebuild the animation manifest for the state now in engine state and drive
	 * it to `progress` (0..1 of that state's own duration).
	 */
	settleAnimation(progress: number): void;
	/**
	 * Acknowledge one composition paint of the swapped-in state. A layout flush
	 * is not a paint: in the standard-browser rasterization lane nothing has
	 * captured the new DOM yet, and in either lane the frame renderer's
	 * paint-generation gate would otherwise keep the previous state's resident
	 * DOM texture.
	 */
	settlePaint(): Promise<void>;
}

/**
 * Settle the state already written into engine state at `progress`: flush the
 * DOM it mounts, wait for its fonts and layout, drive its animation to
 * `progress`, flush and lay out what that moved, then wait for one paint.
 *
 * `assertStillWanted` runs after every wait and throws when the caller has
 * given the swap up, so a superseded settle stops at the next step.
 */
export async function settleSwappedCompositionState(
	dependencies: CompositionStateSwapSettleDependencies,
	progress: number,
	assertStillWanted: () => void = () => undefined
): Promise<void> {
	await dependencies.flushDom();
	assertStillWanted();
	await dependencies.waitForFonts();
	await dependencies.waitForLayout();
	assertStillWanted();

	dependencies.settleAnimation(progress);
	await dependencies.flushDom();
	await dependencies.waitForLayout();
	assertStillWanted();
	await dependencies.settlePaint();
	assertStillWanted();
}
