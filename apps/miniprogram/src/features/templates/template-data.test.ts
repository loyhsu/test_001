import { describe, expect, it } from 'vitest'

import {
  getEditorCanvasPreview,
  getTemplateDetailPreview,
  getTemplateInfo,
  getTemplatePhoto,
} from './template-data'

describe('getTemplateDetailPreview', () => {
  it('shows the paw animation and identifies it as a demo without the user photo', () => {
    const preview = getTemplateDetailPreview('pat-head')

    expect(preview.kind).toBe('animation')
    expect(preview.note).toBe('动作示范，尚未叠加你的照片')
    expect(preview.mode).toBe('aspectFit')
    expect(preview.src).not.toBe(getTemplateInfo('pat-head').previewImage)
  })

  it('keeps templates without an animation on their static demo image', () => {
    const template = getTemplateInfo('shake-head')
    const preview = getTemplateDetailPreview('shake-head')

    expect(preview).toEqual({
      kind: 'photo',
      src: template.previewImage,
      mode: 'aspectFill',
      note: '当前预览使用演示照片',
    })
  })
})

describe('getEditorCanvasPreview', () => {
  it('keeps the original selected photo visible while its transparent subject is processing', () => {
    expect(getEditorCanvasPreview('pat-head', '/tmp/selected-photo.jpg', false, false)).toEqual({
      kind: 'photo',
      src: '/tmp/selected-photo.jpg',
    })
  })

  it('shows the actual transparent subject on the template background after preparation', () => {
    const preview = getEditorCanvasPreview('pat-head', '/tmp/subject.png', true, false)

    expect(preview).toMatchObject({
      kind: 'composition',
      photoSrc: '/tmp/subject.png',
      backgroundSrc: expect.any(String),
      note: '主体已抠出；可拖动、缩放并切换背景',
    })
    if (preview.kind === 'composition') expect(preview.animationSrc).toBeUndefined()
  })

  it('uses the exact preset color in the composition preview', () => {
    expect(getEditorCanvasPreview('pat-head', '/tmp/subject.png', true, false, 'sky-blue'))
      .toMatchObject({ kind: 'composition', backgroundColor: '#DCEEFF' })
  })

  it('adds the motion layer only when the user requests an action preview', () => {
    const preview = getEditorCanvasPreview('pat-head', '/tmp/subject.png', true, true)

    expect(preview).toMatchObject({ kind: 'composition', animationSrc: expect.any(String) })
  })

  it('does not present a static template image as an animation preview', () => {
    expect(getEditorCanvasPreview('shake-head', '/tmp/selected-photo.jpg', true, true)).toEqual({
      kind: 'unavailable',
      note: '该模板暂未提供动图动作示范',
    })
  })
})
