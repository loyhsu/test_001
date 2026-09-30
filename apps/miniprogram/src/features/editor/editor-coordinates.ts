export interface CanvasCenter {
  x: number
  y: number
}

export interface MovableOffset {
  x: number
  y: number
}

export interface MovableAreaSize {
  width: number
  height: number
}

const CANVAS_SIZE = 480
const SUBJECT_MAX_EDGE_RATIO = 0.55
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function viewSizePixels(scale: number, area: MovableAreaSize): number {
  return Math.min(area.width, area.height) * SUBJECT_MAX_EDGE_RATIO * clamp(scale, 0.65, 1.6)
}

export function movableOffsetToCanvasCenter(
  offset: MovableOffset,
  scale: number,
  area: MovableAreaSize,
  viewportWidth: number,
): CanvasCenter {
  if (area.width <= 0 || area.height <= 0 || viewportWidth <= 0) {
    return { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 }
  }
  const halfView = viewSizePixels(scale, area) / 2
  return {
    x: clamp(((offset.x + halfView) / area.width) * CANVAS_SIZE, 0, CANVAS_SIZE),
    y: clamp(((offset.y + halfView) / area.height) * CANVAS_SIZE, 0, CANVAS_SIZE),
  }
}

export function canvasCenterToMovableOffset(
  center: CanvasCenter,
  scale: number,
  area: MovableAreaSize,
  viewportWidth: number,
): MovableOffset {
  if (area.width <= 0 || area.height <= 0 || viewportWidth <= 0) {
    return { x: 0, y: 0 }
  }
  const halfView = viewSizePixels(scale, area) / 2
  return {
    x: (clamp(center.x, 0, CANVAS_SIZE) / CANVAS_SIZE) * area.width - halfView,
    y: (clamp(center.y, 0, CANVAS_SIZE) / CANVAS_SIZE) * area.height - halfView,
  }
}
