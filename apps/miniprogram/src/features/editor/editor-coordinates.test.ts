import { describe, expect, it } from 'vitest'

import {
  canvasCenterToMovableOffset,
  movableOffsetToCanvasCenter,
} from './editor-coordinates'

const area = { width: 320, height: 280 }
const viewportWidth = 375

describe('editor coordinate mapping', () => {
  it('maps drag offsets to the worker canvas center coordinates', () => {
    expect(
      movableOffsetToCanvasCenter({ x: 100, y: 30 }, 1, area, viewportWidth),
    ).toEqual({ x: 265.5, y: 183.42857142857142 })
  })

  it('converts a saved canvas center back to movable offsets at the current scale', () => {
    const offset = canvasCenterToMovableOffset({ x: 315, y: 240 }, 1, area, viewportWidth)

    expect(offset).toEqual({ x: 133, y: 63 })
  })

  it('keeps canvas center coordinates within the visible 480 by 480 bounds', () => {
    expect(
      movableOffsetToCanvasCenter({ x: -500, y: 500 }, 1.6, area, viewportWidth),
    ).toEqual({ x: 0, y: 480 })
  })

  it('round-trips a drag center when the subject occupies 55% of the preview canvas', () => {
    const squareArea = { width: 320, height: 320 }
    const center = { x: 315, y: 240 }
    const offset = canvasCenterToMovableOffset(center, 1, squareArea, viewportWidth)

    expect(offset).toEqual({ x: 122, y: 72 })
    expect(movableOffsetToCanvasCenter(offset, 1, squareArea, viewportWidth)).toEqual(center)
  })
})
