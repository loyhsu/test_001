import { describe, expect, it } from 'vitest'

import { normalizeEditorState } from './contracts'

describe('normalizeEditorState', () => {
  it('clamps subject transform and replaces an unsupported speed', () => {
    expect(
      normalizeEditorState({
        x: 999,
        y: -20,
        scale: 3,
        speed: 'turbo' as never,
        backgroundId: 'unknown' as never,
      }),
    ).toEqual({ x: 480, y: 0, scale: 1.6, speed: 'standard', backgroundId: 'template' })
  })
})
