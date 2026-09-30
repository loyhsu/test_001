import { describe, expect, it } from 'vitest'

import { saveWorkToAlbum, type AlbumPlatform } from './album'
import type { Work } from '../domain/contracts'

const work: Work = {
  id: 'work-12345678',
  templateId: 'pat-head',
  status: 'ready',
  resultUrl: 'https://temporary.example/result.gif',
  editorState: { x: 240, y: 278, scale: 1, speed: 'standard', backgroundId: 'template' },
  createdAt: '2026-09-24T00:00:00.000Z',
  expiresAt: '2026-10-24T00:00:00.000Z',
}

function platform(overrides: Partial<AlbumPlatform> = {}) {
  const calls: string[] = []
  const api: AlbumPlatform = {
    getSetting: async () => ({ authSetting: { 'scope.writePhotosAlbum': true } }),
    authorize: async () => { calls.push('authorize') },
    downloadFile: async (url) => {
      calls.push(`download:${url}`)
      return { tempFilePath: '/tmp/result.gif', statusCode: 200 }
    },
    saveImageToPhotosAlbum: async (filePath) => { calls.push(`save:${filePath}`) },
    ...overrides,
  }
  return { api, calls }
}

describe('saveWorkToAlbum', () => {
  it('downloads the result URL and saves the temporary file to the album', async () => {
    const { api, calls } = platform()

    const result = await saveWorkToAlbum(work, api)

    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([
      'download:https://temporary.example/result.gif',
      'save:/tmp/result.gif',
    ])
  })

  it('asks for permission once and reports a denied request without downloading', async () => {
    const { api, calls } = platform({
      getSetting: async () => ({ authSetting: {} }),
      authorize: async () => { calls.push('authorize'); throw new Error('authorize denied') },
    })

    const result = await saveWorkToAlbum(work, api)

    expect(result).toEqual({ ok: false, reason: 'permission-denied' })
    expect(calls).toEqual(['authorize'])
  })

  it('does not call album APIs for an expired work without a result URL', async () => {
    const { api, calls } = platform()

    const result = await saveWorkToAlbum({ ...work, status: 'expired', resultUrl: undefined }, api)

    expect(result).toEqual({ ok: false, reason: 'missing-result' })
    expect(calls).toEqual([])
  })
})
