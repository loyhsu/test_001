import { describe, expect, it } from 'vitest'

import { preparePhoto } from './photo-preparation'

const image = {
  path: '/tmp/photo.png',
  size: 1200,
  width: 480,
  height: 640,
  type: 'png' as const,
}

function dependencies(order: string[]) {
  return {
    createUploadTicket: async (input: { requestId: string; imageType: string }) => {
      order.push(`ticket:${input.requestId}:${input.imageType}`)
      return {
        uploadTicketId: 'ticket-123456',
        cloudPath: 'uploads/ticket-123456/request-123456/source.png',
        expiresAt: '2026-09-25T04:00:00.000Z',
      }
    },
    uploadFile: async (cloudPath: string, localPath: string) => {
      order.push(`upload:${cloudPath}:${localPath}`)
      return 'cloud://env/uploads/ticket-123456/request-123456/source.png'
    },
    prepareSubject: async (input: {
      requestId: string
      uploadTicketId: string
      sourceFileId: string
    }) => {
      order.push(`prepare:${input.uploadTicketId}:${input.sourceFileId}`)
      return {
        subjectUrl: 'https://temporary.example/subject.png',
        width: 240,
        height: 320,
        expiresAt: '2026-09-25T04:00:00.000Z',
      }
    },
  }
}

describe('photo preparation', () => {
  it('uploads the original photo before requesting a cutout and returns reusable ticket data', async () => {
    const order: string[] = []
    const prepared = await preparePhoto(image, 'request-123456', dependencies(order))

    expect(order).toEqual([
      'ticket:request-123456:png',
      'upload:uploads/ticket-123456/request-123456/source.png:/tmp/photo.png',
      'prepare:ticket-123456:cloud://env/uploads/ticket-123456/request-123456/source.png',
    ])
    expect(prepared).toEqual({
      image,
      requestId: 'request-123456',
      uploadTicket: {
        uploadTicketId: 'ticket-123456',
        cloudPath: 'uploads/ticket-123456/request-123456/source.png',
        expiresAt: '2026-09-25T04:00:00.000Z',
      },
      sourceFileId: 'cloud://env/uploads/ticket-123456/request-123456/source.png',
      subjectUrl: 'https://temporary.example/subject.png',
      width: 240,
      height: 320,
      expiresAt: '2026-09-25T04:00:00.000Z',
    })
  })

  it('propagates a cutout failure without pretending that photo preparation succeeded', async () => {
    const order: string[] = []
    const error = new Error('cutout rejected')
    const deps = {
      ...dependencies(order),
      prepareSubject: async () => {
        order.push('prepare-failed')
        throw error
      },
    }

    await expect(preparePhoto(image, 'request-123456', deps)).rejects.toBe(error)
    expect(order).toEqual([
      'ticket:request-123456:png',
      'upload:uploads/ticket-123456/request-123456/source.png:/tmp/photo.png',
      'prepare-failed',
    ])
  })
})
