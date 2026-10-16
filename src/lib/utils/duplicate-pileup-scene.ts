import { evaluateNamedEase } from '$lib/utils/ease-curves';
import type {
	DuplicatePileupContent,
	DuplicatePileupLayout,
	DuplicatePileupPanelKind
} from '$lib/pipelines/overlays/duplicate-pileup/definition';

// A Duplicate Pileup is laid out here, in frame pixels: each copy drops in at
// the top of its panel and pushes the others down, the panels lean further the
// worse it gets, and the collapse folds every duplicate back into the real one.
// Every value is a pure function of time, so preview and export agree.

const ROW_DROP_SECONDS = 0.32;
const FRESH_SECONDS = 1.4;
const PANEL_POP_SECONDS = 0.45;
const COLLAPSE_SECONDS = 0.5;
const RESTART_HOLD_SECONDS = 1.6;
const LABEL_POP_SECONDS = 0.45;
/** How many duplicates it takes for a panel to lean all the way. */
const FULL_LEAN_DUPLICATES = 4;
const FULL_LEAN_DEGREES = 1.6;

export interface DuplicatePileupSizes {
	textSize: number;
	titleSize: number;
	labelSize: number;
	paddingX: number;
	paddingY: number;
	gap: number;
	radius: number;
}

export interface DuplicatePileupRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface DuplicatePileupRow {
	key: string;
	title: string;
	meta?: string;
	snippet?: string;
	label?: string;
	time?: string;
	/** 1 as a duplicate lands, fading to 0: how strongly it is highlighted as new. */
	fresh: number;
	/** A pull request's number; absent in an inbox. */
	number?: number;
	isDuplicate: boolean;
	/** Top of the row, relative to the panel's list. */
	y: number;
	height: number;
	opacity: number;
}

export interface DuplicatePileupPanelScene {
	key: string;
	kind: DuplicatePileupPanelKind;
	title: string;
	rect: DuplicatePileupRect;
	headerHeight: number;
	pop: number;
	/** Degrees the panel leans as duplicates pile up. */
	lean: number;
	count: number;
	isClean: boolean;
	rows: DuplicatePileupRow[];
}

export interface DuplicatePileupStamp {
	label: string;
	x: number;
	y: number;
	opacity: number;
	scale: number;
}

export interface DuplicatePileupScene {
	unit: number;
	panels: DuplicatePileupPanelScene[];
	restart?: DuplicatePileupStamp;
	collapse?: DuplicatePileupStamp;
}

export function resolveDuplicatePileupLayout(
	shared: DuplicatePileupLayout,
	overrides: DuplicatePileupContent['orientationOverrides'],
	orientation: 'horizontal' | 'vertical'
): DuplicatePileupLayout {
	return overrides?.[orientation] ?? shared;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function settled(progress: number): number {
	return evaluateNamedEase('settled', clamp01(progress));
}

function smooth(progress: number): number {
	return evaluateNamedEase('smooth', clamp01(progress));
}

/** A spring-like pop that overshoots a little before resting at 1. */
function pop(progress: number): number {
	const p = clamp01(progress);
	if (p === 0) return 0;
	return 1 + Math.exp(-6 * p) * Math.sin(p * Math.PI * 2.4 - Math.PI / 2);
}

export function resolveDuplicatePileupScene(
	content: DuplicatePileupContent,
	layout: DuplicatePileupLayout,
	sizes: DuplicatePileupSizes,
	seconds: number,
	durationSeconds: number,
	frameWidth: number,
	frameHeight: number
): DuplicatePileupScene {
	const unit = Math.min(frameWidth, frameHeight) / 100;
	const text = sizes.textSize * unit;
	// A Gmail row is one line; a GitHub pull request row is two.
	const rowHeightOf = (kind: DuplicatePileupPanelKind): number =>
		kind === 'inbox' ? text * 2.9 : text * 4.2;
	const gap = sizes.gap * unit;
	const at = (fraction: number): number => fraction * durationSeconds;

	const collapseSeconds = content.collapse ? at(content.collapse.at) : Number.POSITIVE_INFINITY;
	const fold = smooth((seconds - collapseSeconds) / COLLAPSE_SECONDS);
	const isClean = seconds >= collapseSeconds;

	const panelWidth = layout.width * frameWidth;
	const panelHeight = layout.height * frameHeight;
	const panels: DuplicatePileupPanelScene[] = content.panels
		.map((panel, index) => ({ panel, index }))
		.filter(({ panel }) => at(panel.at) <= seconds)
		.map(({ panel, index }) => {
			const rect = {
				x: layout.x * frameWidth + (layout.arrangement === 'row' ? index * (panelWidth + gap) : 0),
				y: layout.y * frameHeight + (layout.arrangement === 'column' ? index * (panelHeight + gap) : 0),
				width: panelWidth,
				height: panelHeight
			};
			const arrived = panel.copies
				.map((fraction, copy) => ({ copy, seconds: at(fraction) }))
				.filter((item) => item.seconds <= seconds)
				.sort((a, b) => a.seconds - b.seconds);

			// Newest on top: walk from the newest copy down, each pushed by the ones above it.
			const rowHeight = rowHeightOf(panel.kind);
			const rows: DuplicatePileupRow[] = [];
			let top = 0;
			for (let order = arrived.length - 1; order >= 0; order -= 1) {
				const item = arrived[order];
				const drop = settled((seconds - item.seconds) / ROW_DROP_SECONDS);
				const isDuplicate = order > 0;
				const y = (top - (1 - drop) * rowHeight * 0.6) * (1 - fold);
				rows.push({
					key: `copy-${item.copy}`,
					title: panel.item,
					meta: panel.meta,
					snippet: panel.snippet,
					label: panel.label,
					time: panel.time,
					fresh: isDuplicate ? 1 - clamp01((seconds - item.seconds) / FRESH_SECONDS) : 0,
					number: panel.number === undefined ? undefined : panel.number + order,
					isDuplicate,
					y,
					height: rowHeight,
					opacity: clamp01(drop * 1.5) * (isDuplicate ? 1 - fold : 1)
				});
				top += rowHeight * drop;
			}

			const duplicates = Math.max(0, arrived.length - 1);
			const side = index % 2 === 0 ? -1 : 1;
			return {
				key: `panel-${index}`,
				kind: panel.kind,
				title: panel.title,
				rect,
				headerHeight: sizes.titleSize * unit * 1.4 + sizes.paddingY * unit * 2,
				pop: pop((seconds - at(panel.at)) / PANEL_POP_SECONDS),
				lean:
					side * FULL_LEAN_DEGREES * Math.min(1, duplicates / FULL_LEAN_DUPLICATES) * (1 - fold),
				count: isClean ? Math.min(1, arrived.length) : arrived.length,
				isClean,
				rows
			};
		});

	const groupWidth =
		layout.arrangement === 'row'
			? content.panels.length * panelWidth + (content.panels.length - 1) * gap
			: panelWidth;
	const groupHeight =
		layout.arrangement === 'column'
			? content.panels.length * panelHeight + (content.panels.length - 1) * gap
			: panelHeight;
	const centerX = layout.x * frameWidth + groupWidth / 2;

	let restart: DuplicatePileupStamp | undefined;
	if (content.restart) {
		const since = seconds - at(content.restart.at);
		if (since >= 0 && since < RESTART_HOLD_SECONDS + 0.4) {
			restart = {
				label: content.restart.label,
				x: centerX,
				y: layout.y * frameHeight - unit * 5,
				opacity: clamp01(since / 0.15) * (1 - smooth((since - RESTART_HOLD_SECONDS) / 0.4)),
				scale: pop(since / LABEL_POP_SECONDS)
			};
		}
	}

	let collapse: DuplicatePileupStamp | undefined;
	if (content.collapse && seconds >= collapseSeconds) {
		const since = seconds - collapseSeconds - COLLAPSE_SECONDS * 0.5;
		collapse = {
			label: content.collapse.label,
			x: centerX,
			y: layout.y * frameHeight + groupHeight + unit * 7,
			opacity: clamp01(since / 0.15),
			scale: pop(since / LABEL_POP_SECONDS)
		};
	}

	return { unit, panels, restart, collapse };
}
