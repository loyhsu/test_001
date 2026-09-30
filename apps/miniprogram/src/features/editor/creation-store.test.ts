import { describe, expect, it } from 'vitest'

import {
  clearPendingGeneration,
  getPreparedPhoto,
  getPendingGeneration,
  setPreparedPhoto,
  setSelectedImage,
  setPendingGeneration,
  updatePendingGeneration,
} from './creation-store'

describe('pending generation store', () => {
  it('preserves the same request and source data between editor and processing pages', () => {
    const pending = {
      requestId: 'request-123',
      templateId: 'pat-head',
      editorState: { x: 240, y: 278, scale: 1, speed: 'standard' as const, backgroundId: 'template' as const },
      sourceImage: { path: '/tmp/photo.png', size: 1200, width: 480, height: 640, type: 'png' as const },
    }

    setPendingGeneration(pending)
    expect(getPendingGeneration()).toBe(pending)

    const updated = updatePendingGeneration({ sourceFileId: 'cloud://env/source.png' })
    expect(updated?.sourceImage).toEqual(pending.sourceImage)
    expect(updated?.sourceFileId).toBe('cloud://env/source.png')

    clearPendingGeneration()
    expect(getPendingGeneration()).toBeUndefined()
  })

  it('clears the previous prepared subject when the user replaces the photo', () => {
    const first = { path: '/tmp/first.png', size: 100, width: 480, height: 640, type: 'png' as const }
    const second = { path: '/tmp/second.png', size: 100, width: 480, height: 640, type: 'png' as const }
    setSelectedImage(first)
    setPreparedPhoto({
      image: first,
      requestId: 'request-123456',
      uploadTicket: {
        uploadTicketId: 'ticket-123456',
        cloudPath: 'uploads/ticket-123456/request-123456/source.png',
        expiresAt: '2026-09-25T04:00:00.000Z',
      },
      sourceFileId: 'cloud://env/source.png',
      subjectUrl: 'https://temporary.example/subject.png',
      width: 240,
      height: 320,
      expiresAt: '2026-09-25T04:00:00.000Z',
    })

    setSelectedImage(second)

    expect(getPreparedPhoto()).toBeUndefined()
  })
})
