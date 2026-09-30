import { describe, expect, it } from 'vitest'
import { editorReducer, initialEditorState, scaleFromSliderValue } from './editor-state'

import * as editorState from './editor-state'

const getPhotoSelectionActionLabel = (
  editorState as unknown as Record<string, unknown>
).getPhotoSelectionActionLabel

describe('photo selection action label', () => {
  it('prompts for the first photo when none is selected', () => {
    expect(getPhotoSelectionActionLabel).toBeTypeOf('function')
    expect(
      (getPhotoSelectionActionLabel as (hasSourceImage: boolean) => string)(false),
    ).toBe('选择照片')
  })

  it('offers to replace the photo when one is already selected', () => {
    expect(getPhotoSelectionActionLabel).toBeTypeOf('function')
    expect(
      (getPhotoSelectionActionLabel as (hasSourceImage: boolean) => string)(true),
    ).toBe('更换照片')
  })
})

describe('editor scale slider', () => {
  it('converts the slider percentage into the photo scale', () => {
    const updated = editorReducer(initialEditorState, {
      type: 'scale',
      scale: scaleFromSliderValue(137),
    })

    expect(updated.scale).toBe(1.37)
  })

  it('preserves the selected background in editor state', () => {
    const updated = editorReducer(initialEditorState, {
      type: 'background',
      backgroundId: 'cream',
    })

    expect(updated.backgroundId).toBe('cream')
    expect(editorReducer(updated, { type: 'speed', speed: 'fast' }).backgroundId).toBe('cream')
  })
})
