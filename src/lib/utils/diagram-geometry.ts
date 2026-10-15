import type {
	DiagramCode,
	DiagramCodeGeometry,
	DiagramEdgeArrow,
	DiagramEdgeGeometry,
	DiagramEndpoint,
	DiagramLabel,
	DiagramLabelGeometry,
	DiagramNode,
	DiagramNodeGeometry,
	DiagramPositionGeometry,
	DiagramPrimitive,
	DiagramStatCallout,
	DiagramTimelineGeometry,
	DiagramTimelineSegment
} from '$lib/platform/engine-schema';

import type { VideoOrientation } from './video-frame';

type DiagramPositionedPrimitive = DiagramNode | DiagramLabel | DiagramStatCallout | DiagramCode;

export type DiagramPrimitiveGeometry =
	| DiagramPositionGeometry
	| DiagramNodeGeometry
	| DiagramLabelGeometry
	| DiagramCodeGeometry
	| DiagramEdgeGeometry
	| DiagramTimelineGeometry;

/** The code panel's and node's own sizes, carried with their position (ADR-0070). */
const DIAGRAM_GEOMETRY_SIZE_FIELDS = [
	'fontSize',
	'paddingX',
	'paddingY',
	'minWidth',
	'minHeight',
	'borderWidth',
	'logoSize',
	'logoGap'
] as const;

export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramNode,
	orientation: VideoOrientation
): DiagramNodeGeometry;
export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramStatCallout,
	orientation: VideoOrientation
): DiagramPositionGeometry;
export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramCode,
	orientation: VideoOrientation
): DiagramCodeGeometry;
export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramLabel,
	orientation: VideoOrientation
): DiagramLabelGeometry;
export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramPositionedPrimitive,
	orientation: VideoOrientation
): DiagramPositionGeometry | DiagramNodeGeometry | DiagramLabelGeometry | DiagramCodeGeometry;
export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramEdgeArrow,
	orientation: VideoOrientation
): DiagramEdgeGeometry;
export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramTimelineSegment,
	orientation: VideoOrientation
): DiagramTimelineGeometry;
export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramPrimitive,
	orientation: VideoOrientation
): DiagramPrimitiveGeometry {
	return primitive.orientationOverrides?.[orientation] ?? primitive;
}

function cloneDiagramEndpoint(endpoint: DiagramEndpoint): DiagramEndpoint {
	return 'node' in endpoint ? { node: endpoint.node } : { ...endpoint };
}

export function cloneDiagramPrimitiveGeometry(geometry: DiagramLabelGeometry): DiagramLabelGeometry;
export function cloneDiagramPrimitiveGeometry(geometry: DiagramCodeGeometry): DiagramCodeGeometry;
export function cloneDiagramPrimitiveGeometry(geometry: DiagramNodeGeometry): DiagramNodeGeometry;
export function cloneDiagramPrimitiveGeometry(
	geometry: DiagramPositionGeometry
): DiagramPositionGeometry;
export function cloneDiagramPrimitiveGeometry(
	geometry:
		| DiagramPositionGeometry
		| DiagramNodeGeometry
		| DiagramLabelGeometry
		| DiagramCodeGeometry
): DiagramPositionGeometry | DiagramNodeGeometry | DiagramLabelGeometry | DiagramCodeGeometry;
export function cloneDiagramPrimitiveGeometry(geometry: DiagramEdgeGeometry): DiagramEdgeGeometry;
export function cloneDiagramPrimitiveGeometry(
	geometry: DiagramTimelineGeometry
): DiagramTimelineGeometry;
export function cloneDiagramPrimitiveGeometry(
	geometry: DiagramPrimitiveGeometry
): DiagramPrimitiveGeometry {
	if ('position' in geometry) {
		const positionGeometry: DiagramPositionGeometry = {
			position: { ...geometry.position },
			scale: geometry.scale
		};
		if ('maxWidth' in geometry && !('paddingX' in geometry)) {
			const labelGeometry: DiagramLabelGeometry = {
				...positionGeometry,
				maxWidth: geometry.maxWidth
			};
			if ('fontSize' in geometry) labelGeometry.fontSize = geometry.fontSize;
			return labelGeometry;
		}
		const sizes = DIAGRAM_GEOMETRY_SIZE_FIELDS.filter((field) => field in geometry);
		if (sizes.length === 0) return positionGeometry;
		const sizedGeometry = geometry as DiagramCodeGeometry & DiagramNodeGeometry;
		return {
			...positionGeometry,
			...Object.fromEntries(sizes.map((field) => [field, sizedGeometry[field]]))
		};
	}
	if ('route' in geometry) {
		return {
			from: cloneDiagramEndpoint(geometry.from),
			to: cloneDiagramEndpoint(geometry.to),
			route: geometry.route,
			control: geometry.control ? { ...geometry.control } : undefined
		};
	}
	return {
		from: { ...geometry.from },
		to: { ...geometry.to }
	};
}

export function resolveDiagramPrimitiveForRender(
	primitive: DiagramPrimitive,
	orientation: VideoOrientation
): DiagramPrimitive {
	switch (primitive.type) {
		case 'node': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			return {
				...primitive,
				position: { ...geometry.position },
				scale: geometry.scale,
				fontSize: geometry.fontSize,
				paddingX: geometry.paddingX,
				paddingY: geometry.paddingY,
				borderWidth: geometry.borderWidth,
				logoSize: geometry.logoSize,
				logoGap: geometry.logoGap
			};
		}
		case 'label': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			return {
				...primitive,
				position: { ...geometry.position },
				scale: geometry.scale,
				fontSize: geometry.fontSize,
				maxWidth: geometry.maxWidth
			};
		}
		case 'stat-callout': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			return {
				...primitive,
				position: { ...geometry.position },
				scale: geometry.scale
			};
		}
		case 'code': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			return {
				...primitive,
				position: { ...geometry.position },
				scale: geometry.scale,
				fontSize: geometry.fontSize,
				paddingX: geometry.paddingX,
				paddingY: geometry.paddingY,
				minWidth: geometry.minWidth,
				minHeight: geometry.minHeight
			};
		}
		case 'edge-arrow': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			return {
				...primitive,
				from: cloneDiagramEndpoint(geometry.from),
				to: cloneDiagramEndpoint(geometry.to),
				route: geometry.route,
				control: geometry.control ? { ...geometry.control } : undefined
			};
		}
		case 'timeline-segment': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			return {
				...primitive,
				from: { ...geometry.from },
				to: { ...geometry.to }
			};
		}
	}
}
