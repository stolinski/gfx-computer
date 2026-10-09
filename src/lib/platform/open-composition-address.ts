/**
 * The page follows the open document
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §4,
 * [ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §3).
 *
 * A lifecycle operation replaces the open document: a new Film, a stored Film,
 * or a corpus Preset. Its address is `/p/<slug>`. This module is the one seam
 * between the operation that opened it and the shell that owns the URL, the way
 * `./composition-workspace-focus.ts` is the seam for the visible focus. The
 * operation calls `moveToOpenCompositionAddress`; the root layout is the one
 * navigator; the preset route asks `takeOpenCompositionArrival` when it
 * arrives. The GUI and a WebMCP tool therefore land on the same URL by the
 * same path, and no component navigates by hand after a lifecycle operation.
 *
 * It imports nothing from the app shell, so the operations stay runnable where
 * there is no router. With no navigator installed, a move does nothing.
 */

/** Where an open document lives: the slug of `/p/<slug>`. */
export interface OpenCompositionAddress {
	slug: string;
}

/** Moves the page to an address. Installed once, by the root layout. */
export type OpenCompositionAddressNavigator = (address: OpenCompositionAddress) => Promise<void>;

let installedNavigator: OpenCompositionAddressNavigator | null = null;

/**
 * The slug the page is on its way to because a lifecycle operation opened the
 * document that lives there. Held from the move until the preset route takes
 * it, so the route can tell "I arrived because this document was just opened"
 * from "someone navigated here and the document must be loaded".
 */
let arrivingSlug: string | null = null;

/**
 * Install the one navigator. Returns the function that removes it, which only
 * removes the navigator it installed.
 */
export function installOpenCompositionAddressNavigator(
	navigator: OpenCompositionAddressNavigator
): () => void {
	installedNavigator = navigator;
	return () => {
		if (installedNavigator === navigator) installedNavigator = null;
	};
}

/**
 * Move the page to the document a lifecycle operation just opened. Called
 * after the document is in engine state, never for an operation that failed.
 *
 * A navigation that fails is logged and leaves the operation's receipt as it
 * was: the document is open and, when it is a Film, stored.
 */
export async function moveToOpenCompositionAddress(address: OpenCompositionAddress): Promise<void> {
	const navigator = installedNavigator;
	if (navigator === null) return;
	arrivingSlug = address.slug;
	try {
		await navigator(address);
	} catch (cause) {
		if (arrivingSlug === address.slug) arrivingSlug = null;
		console.error('Failed to move the page to the open composition.', {
			slug: address.slug,
			cause
		});
	}
}

/**
 * Whether the preset route arrived at `slug` because a lifecycle operation
 * opened the document that lives there. True at most once per move: the
 * arrival is taken, so a later visit to the same slug loads it afresh.
 *
 * When this is true the open document is already the one the URL names. The
 * route keeps it as it is: no fetch, no re-apply, the undo history and the
 * Composition revision the operation's receipt reported untouched.
 */
export function takeOpenCompositionArrival(slug: string): boolean {
	const arriving = arrivingSlug;
	arrivingSlug = null;
	return arriving === slug;
}

/**
 * Whether the page is on its way to `slug` with its document already open. The
 * preset route reads this while the URL has changed and it has not taken the
 * arrival yet, so it keeps the Workspace mounted through the move.
 */
export function isOpenCompositionArrivingAt(slug: string): boolean {
	return arrivingSlug === slug;
}

/** Forget an arrival nothing took, so it cannot be mistaken for a later visit. */
export function discardOpenCompositionArrival(): void {
	arrivingSlug = null;
}
