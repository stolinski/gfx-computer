import type { VideoOrientation } from './video-frame.ts';
import { getLayoutSafeArea } from './safe-area.ts';

/**
 * Framings of the website-screenshot Surface (variants-as-data, ADR-0020):
 * `browser` is the shipped showcase — a browser window inside the safe area
 * with every capture edge visible; `filmed` (ADR-0057) lays the capture at
 * native density covering the frame with no chrome, anchored by
 * `surface.pageAnchor`, for a page the camera films up close.
 */
export const WEBSITE_SCREENSHOT_FRAMINGS = ['browser', 'filmed'] as const;

export type WebsiteScreenshotFraming = (typeof WEBSITE_SCREENSHOT_FRAMINGS)[number];

export function websiteScreenshotFraming(variant: string | undefined): WebsiteScreenshotFraming {
	return variant === 'filmed' ? 'filmed' : 'browser';
}

export const WEBSITE_CAPTURE_WIDTH = 1440;
export const WEBSITE_CAPTURE_HEIGHT = 900;
export const WEBSITE_CAPTURE_ASPECT = WEBSITE_CAPTURE_WIDTH / WEBSITE_CAPTURE_HEIGHT;

export interface WebsiteShowcaseLayout {
	frame: { width: number; height: number };
	browser: {
		x: number;
		y: number;
		width: number;
		height: number;
		chromeHeight: number;
		screenshotHeight: number;
	};
	urlPlate: {
		centerX: number;
		centerY: number;
		fontSize: number;
		height: number;
		width: number;
	};
	overlapHeight: number;
}

export type WebsiteImageState = 'missing' | 'loading' | 'ready' | 'broken';

export function normalizeWebsiteCaptureUrl(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) throw new TypeError('Website URL is required');
	const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
	let url: URL;
	try {
		url = new URL(withProtocol);
	} catch (errorValue) {
		throw new TypeError('Website URL is invalid', { cause: errorValue });
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new TypeError('Website URL must use http or https');
	}
	url.hash = '';
	return url.toString();
}

export function websiteDisplayUrl(value: string): string {
	const url = new URL(normalizeWebsiteCaptureUrl(value));
	const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
	return `${url.hostname.replace(/^www\./i, '')}${pathname}${url.search}`;
}

export function websiteImageState(
	imageUrl: string | undefined,
	loadedUrl: string,
	failedUrl: string
): WebsiteImageState {
	if (!imageUrl) return 'missing';
	if (failedUrl === imageUrl) return 'broken';
	if (loadedUrl === imageUrl) return 'ready';
	return 'loading';
}

export function calculateWebsiteShowcaseLayout(
	orientation: VideoOrientation,
	frameWidth: number,
	frameHeight: number
): WebsiteShowcaseLayout {
	if (frameWidth <= 0 || frameHeight <= 0) {
		throw new RangeError('Website showcase frame dimensions must be positive');
	}

	const safe = getLayoutSafeArea(orientation);
	const safeWidth = frameWidth * (1 - safe.left - safe.right);
	const safeHeight = frameHeight * (1 - safe.top - safe.bottom);
	const shortEdge = Math.min(frameWidth, frameHeight);
	const fontSize = Math.round(shortEdge * (orientation === 'vertical' ? 0.036 : 0.031));
	const plateHeight = Math.ceil((fontSize * 1.9) / 2) * 2;
	const overlapHeight = plateHeight / 2;
	const chromeRatio = orientation === 'vertical' ? 0.045 : 0.038;
	const maxWidthByHeight =
		(safeHeight - overlapHeight) / (1 / WEBSITE_CAPTURE_ASPECT + chromeRatio);
	const browserWidth = Math.floor(Math.min(safeWidth, maxWidthByHeight));
	const screenshotHeight = Math.round(browserWidth / WEBSITE_CAPTURE_ASPECT);
	const chromeHeight = Math.round(browserWidth * chromeRatio);
	const browserHeight = screenshotHeight + chromeHeight;
	const stackHeight = browserHeight + overlapHeight;
	const safeTop = frameHeight * safe.top;
	const browserY = Math.round(safeTop + (safeHeight - stackHeight) / 2 + overlapHeight);
	const safeLeft = frameWidth * safe.left;
	const browserX = Math.round(safeLeft + (safeWidth - browserWidth) / 2);
	const plateWidthRatio = orientation === 'vertical' ? 0.78 : 0.5;

	return {
		frame: { width: frameWidth, height: frameHeight },
		browser: {
			x: browserX,
			y: browserY,
			width: browserWidth,
			height: browserHeight,
			chromeHeight,
			screenshotHeight
		},
		urlPlate: {
			centerX: browserX + browserWidth / 2,
			centerY: browserY,
			fontSize,
			height: plateHeight,
			width: Math.round(browserWidth * plateWidthRatio)
		},
		overlapHeight
	};
}

/** Where a filmed page lands in the frame: the capture scaled to cover the frame, offset so the anchored page point sits at centre. */
export interface FilmedPageLayout {
	left: number;
	top: number;
	width: number;
	height: number;
	/** Frame pixels per capture pixel. */
	scale: number;
}

/**
 * The `filmed` framing of the website-screenshot Surface (ADR-0057): the
 * capture is laid at NATIVE DENSITY — one capture pixel per frame pixel — and
 * only scaled up when it is smaller than the frame, so a capture wider than
 * the native target keeps page beyond every frame edge for the oblique camera
 * to look across. No browser chrome; the authored page anchor (capture
 * fractions) sits at the frame centre, clamped so a frame edge never sees past
 * the page under the frontal camera. The frame is a crop into the page, the
 * way ADR-0056 crops into the newspaper.
 */
/** A page point in capture fractions (x right, y down). */
export interface WebsitePageAnchor {
	x: number;
	y: number;
}

/**
 * The page point the filmed framing centres in `orientation` (ADR-0039 §4):
 * that orientation's own point, else the shared `pageAnchor`, else the page
 * centre.
 */
export function resolveSurfacePageAnchor(
	surface: {
		pageAnchor?: WebsitePageAnchor;
		pageAnchorOrientationOverrides?: Partial<Record<'horizontal' | 'vertical', WebsitePageAnchor>>;
	},
	orientation: 'horizontal' | 'vertical'
): WebsitePageAnchor {
	return (
		surface.pageAnchorOrientationOverrides?.[orientation] ??
		surface.pageAnchor ?? { x: 0.5, y: 0.5 }
	);
}

export function calculateFilmedPageLayout(
	frameWidth: number,
	frameHeight: number,
	captureWidth: number,
	captureHeight: number,
	anchor: { x: number; y: number } = { x: 0.5, y: 0.5 }
): FilmedPageLayout {
	if (frameWidth <= 0 || frameHeight <= 0 || captureWidth <= 0 || captureHeight <= 0) {
		throw new RangeError('Filmed page frame and capture dimensions must be positive');
	}
	const scale = Math.max(1, frameWidth / captureWidth, frameHeight / captureHeight);
	const width = captureWidth * scale;
	const height = captureHeight * scale;
	const anchorX = Math.min(1, Math.max(0, anchor.x));
	const anchorY = Math.min(1, Math.max(0, anchor.y));
	const left = Math.min(0, Math.max(frameWidth - width, frameWidth / 2 - anchorX * width));
	const top = Math.min(0, Math.max(frameHeight - height, frameHeight / 2 - anchorY * height));
	return { left, top, width, height, scale };
}

export interface EnterBlurCommitDeduper {
	shouldCommit(trigger: 'enter' | 'blur'): boolean;
}

export function createEnterBlurCommitDeduper(): EnterBlurCommitDeduper {
	let suppressNextBlur = false;
	return {
		shouldCommit(trigger): boolean {
			if (trigger === 'enter') {
				suppressNextBlur = true;
				return true;
			}
			if (suppressNextBlur) {
				suppressNextBlur = false;
				return false;
			}
			return true;
		}
	};
}
