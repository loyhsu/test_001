import { describe, expect, it } from 'vitest'

import { getEditorBackDestination } from './editor-navigation'

describe('getEditorBackDestination', () => {
  it('returns to the previous page when the editor has navigation history', () => {
    expect(getEditorBackDestination(2)).toBe('previous-page')
  })

  it('opens the current template detail when the editor is the only page', () => {
    expect(getEditorBackDestination(1)).toBe('template-detail')
    expect(getEditorBackDestination(0)).toBe('template-detail')
  })
})
