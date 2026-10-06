import type { FrameRate } from '$lib/utils/composition-timing';

export interface SimulationStepRate {
	num: number;
	den: number;
}

export interface AuthoredSimulationEvent<TEvent> {
	id: string;
	step: number;
	value: TEvent;
}

export interface SimulationStepInput<TEvent> {
	stepIndex: number;
	deltaSeconds: number;
	events: readonly AuthoredSimulationEvent<TEvent>[];
}

export interface SeekableSimulationKernel<TState, TEvent> {
	reset(seed: number): TState;
	step(state: TState, input: SimulationStepInput<TEvent>): TState;
	clone(state: TState): TState;
	dispose?(state: TState): void;
}

export function simulationStepForFrame(
	frame: number,
	transportRate: FrameRate,
	stepRate: SimulationStepRate
): number {
	if (!Number.isInteger(frame) || frame < 0) {
		throw new TypeError(`Simulation frame must be a non-negative integer, got ${frame}.`);
	}
	if (
		!Number.isInteger(stepRate.num) ||
		!Number.isInteger(stepRate.den) ||
		stepRate.num <= 0 ||
		stepRate.den <= 0
	) {
		throw new TypeError('Simulation step rate must be a positive integer rational.');
	}
	return Math.floor(
		(frame * transportRate.den * stepRate.num) / (transportRate.num * stepRate.den)
	);
}

/**
 * Deterministic fixed-step state owner. Forward seeks continue from the current
 * state; backward seeks and seed changes reset then replay. No timer or render
 * loop is owned here, so preview scrubs and serial exports address identical
 * states by integer step.
 */
export class SeekableSimulationRuntime<TState, TEvent> {
	readonly #kernel: SeekableSimulationKernel<TState, TEvent>;
	readonly #stepRate: SimulationStepRate;
	#state: TState | null = null;
	#seed: number | null = null;
	#currentStep = -1;
	#isDisposed = false;

	constructor(
		stepRate: SimulationStepRate,
		kernel: SeekableSimulationKernel<TState, TEvent>
	) {
		if (stepRate.num <= 0 || stepRate.den <= 0) {
			throw new TypeError('Simulation step rate must be positive.');
		}
		this.#stepRate = stepRate;
		this.#kernel = kernel;
	}

	seek(
		targetStep: number,
		seed: number,
		events: readonly AuthoredSimulationEvent<TEvent>[] = []
	): TState {
		this.#assertUsable();
		if (!Number.isInteger(targetStep) || targetStep < 0) {
			throw new TypeError(`Simulation target step must be a non-negative integer, got ${targetStep}.`);
		}
		if (!Number.isInteger(seed)) {
			throw new TypeError(`Simulation seed must be an integer, got ${seed}.`);
		}

		if (this.#state === null || this.#seed !== seed || targetStep < this.#currentStep) {
			this.#reset(seed);
		}

		const eventsByStep = new Map<number, AuthoredSimulationEvent<TEvent>[]>();
		for (const event of events) {
			if (!Number.isInteger(event.step) || event.step < 0) {
				throw new TypeError(`Simulation event "${event.id}" has invalid step ${event.step}.`);
			}
			const entries = eventsByStep.get(event.step) ?? [];
			entries.push(event);
			eventsByStep.set(event.step, entries);
		}
		for (const entries of eventsByStep.values()) {
			entries.sort((a, b) => a.id.localeCompare(b.id));
		}

		for (let stepIndex = this.#currentStep + 1; stepIndex <= targetStep; stepIndex += 1) {
			this.#state = this.#kernel.step(this.#state as TState, {
				stepIndex,
				deltaSeconds: this.#stepRate.den / this.#stepRate.num,
				events: eventsByStep.get(stepIndex) ?? []
			});
			this.#currentStep = stepIndex;
		}

		return this.snapshot();
	}

	snapshot(): TState {
		this.#assertUsable();
		if (this.#state === null) {
			throw new Error('Simulation state is unavailable before the first seek.');
		}
		return this.#kernel.clone(this.#state);
	}

	dispose(): void {
		if (this.#isDisposed) return;
		this.#isDisposed = true;
		if (this.#state !== null) this.#kernel.dispose?.(this.#state);
		this.#state = null;
		this.#seed = null;
		this.#currentStep = -1;
	}

	#reset(seed: number): void {
		if (this.#state !== null) this.#kernel.dispose?.(this.#state);
		this.#state = this.#kernel.reset(seed);
		this.#seed = seed;
		this.#currentStep = -1;
	}

	#assertUsable(): void {
		if (this.#isDisposed) throw new Error('Seekable simulation runtime is disposed.');
	}
}
