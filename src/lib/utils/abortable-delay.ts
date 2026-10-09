/**
 * Wait `delayMs`, or reject with the signal's reason the moment it aborts — so a
 * polling loop stops waiting as soon as its caller gives up.
 */
export function waitForAbortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const handleAbort = (): void => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', handleAbort);
			resolve();
		}, delayMs);
		signal?.addEventListener('abort', handleAbort, { once: true });
	});
}
