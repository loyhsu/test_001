import { describe, expect, it, vi } from 'vitest'

import { createEmojiChatPlatform, sendWorkToChat, type EmojiChatPlatform, type NativeEmojiApi } from './emoji-chat'
import type { Work } from '../domain/contracts'

const work: Work = {
  id: 'work-12345678',
  templateId: 'pat-head',
  status: 'ready',
  resultUrl: 'https://temporary.example/result.gif',
  editorState: { x: 240, y: 278, scale: 1, speed: 'standard', backgroundId: 'template' },
  createdAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2026-10-31T00:00:00.000Z',
}

function platform(overrides: Partial<EmojiChatPlatform> = {}) {
  const calls: string[] = []
  const api: EmojiChatPlatform = {
    getApiCategory: async () => 'default',
    downloadFile: async (url) => {
      calls.push(`download:${url}`)
      return { tempFilePath: '/tmp/result.gif', statusCode: 200 }
    },
    enterChatToolMode: async () => { calls.push('select-chat') },
    shareEmojiToGroup: async (path) => { calls.push(`send-emoji:${path}`) },
    ...overrides,
  }
  return { api, calls }
}

describe('sendWorkToChat', () => {
  it.each(['default', 'chatTool'])('stops after departure during download in %s mode', async (category) => {
    let finishDownload!: (value: { tempFilePath: string; statusCode: number }) => void
    const downloadFile = vi.fn(() => new Promise<{ tempFilePath: string; statusCode: number }>((resolve) => { finishDownload = resolve }))
    const { api, calls } = platform({ getApiCategory: async () => category, downloadFile })
    const controller = new AbortController()
    const pending = sendWorkToChat(work, api, { isActive: () => !controller.signal.aborted })
    await vi.waitFor(() => expect(downloadFile).toHaveBeenCalledOnce())
    controller.abort()
    finishDownload({ tempFilePath: '/tmp/result.gif', statusCode: 200 })
    expect(await pending).toEqual({ ok: false, reason: 'cancelled' })
    expect(calls).toEqual([])
  })

  it('does not send when the page unloads while the native selector is open', async () => {
    let finishSelection!: () => void
    const enterChatToolMode = vi.fn(() => new Promise<void>((resolve) => { finishSelection = resolve }))
    const { api, calls } = platform({ enterChatToolMode })
    const controller = new AbortController()
    const pending = sendWorkToChat(work, api, { isActive: () => !controller.signal.aborted })
    await vi.waitFor(() => expect(enterChatToolMode).toHaveBeenCalledOnce())
    controller.abort()
    finishSelection()
    expect(await pending).toEqual({ ok: false, reason: 'cancelled' })
    expect(calls).toEqual(['download:https://temporary.example/result.gif'])
  })

  it('marks native UI handoff only after download so its own page-hide does not cancel selection', async () => {
    const { api, calls } = platform()
    const onNativeFlow = () => { calls.push('native-ui') }
    expect(await sendWorkToChat(work, api, { onNativeFlow })).toEqual({ ok: true })
    expect(calls).toEqual(['download:https://temporary.example/result.gif', 'native-ui', 'select-chat', 'send-emoji:/tmp/result.gif'])
  })

  it('downloads the GIF before selecting a chat and sends the local path as an emoji', async () => {
    const { api, calls } = platform()
    expect(await sendWorkToChat(work, api)).toEqual({ ok: true })
    expect(calls).toEqual([
      'download:https://temporary.example/result.gif', 'select-chat', 'send-emoji:/tmp/result.gif',
    ])
  })

  it('uses the current chat without opening another chat selector', async () => {
    const { api, calls } = platform({ getApiCategory: async () => 'chatTool', enterChatToolMode: undefined })
    expect(await sendWorkToChat(work, api)).toEqual({ ok: true })
    expect(calls).toEqual(['download:https://temporary.example/result.gif', 'send-emoji:/tmp/result.gif'])
  })

  it.each(['processing', 'failed', 'expired'] as const)('does not send a %s work', async (status) => {
    const { api, calls } = platform()
    expect(await sendWorkToChat({ ...work, status }, api)).toEqual({ ok: false, reason: 'missing-result' })
    expect(calls).toEqual([])
  })

  it('does not send a work without its result URL', async () => {
    const { api, calls } = platform()
    expect(await sendWorkToChat({ ...work, resultUrl: undefined }, api)).toEqual({ ok: false, reason: 'missing-result' })
    expect(calls).toEqual([])
  })

  it.each(['enterChatToolMode', 'shareEmojiToGroup'] as const)('does not download when %s is unavailable', async (method) => {
    const { api, calls } = platform({ [method]: undefined })
    expect(await sendWorkToChat(work, api)).toEqual({ ok: false, reason: 'unsupported' })
    expect(calls).toEqual([])
  })

  it.each([
    { statusCode: 403, tempFilePath: '/tmp/error.gif' },
    { statusCode: 200, tempFilePath: '' },
  ])('rejects a failed or empty download before selecting a chat', async (downloaded) => {
    const { api, calls } = platform({ downloadFile: async () => downloaded })
    expect(await sendWorkToChat(work, api)).toEqual({ ok: false, reason: 'download-failed' })
    expect(calls).toEqual([])
  })

  it('reports a network download failure without sending', async () => {
    const { api, calls } = platform({ downloadFile: async () => { throw new Error('network') } })
    expect(await sendWorkToChat(work, api)).toEqual({ ok: false, reason: 'download-failed' })
    expect(calls).toEqual([])
  })

  it('does not send when the user cancels chat selection', async () => {
    const { api, calls } = platform({ enterChatToolMode: async () => { throw { errMsg: 'enterChatToolMode:fail cancel' } } })
    expect(await sendWorkToChat(work, api)).toEqual({ ok: false, reason: 'cancelled' })
    expect(calls).toEqual(['download:https://temporary.example/result.gif'])
  })

  it('reports lack of chat permission without sending', async () => {
    const { api, calls } = platform({ enterChatToolMode: async () => { throw { errMsg: 'enterChatToolMode:fail no permission' } } })
    expect(await sendWorkToChat(work, api)).toEqual({ ok: false, reason: 'send-failed' })
    expect(calls).toEqual(['download:https://temporary.example/result.gif'])
  })

  it('reports a failed emoji handoff rather than treating it as sent', async () => {
    const { api } = platform({ shareEmojiToGroup: async () => { throw new Error('rejected') } })
    expect(await sendWorkToChat(work, api)).toEqual({ ok: false, reason: 'send-failed' })
  })

  it('treats a cancelled emoji send as cancellation, not failure', async () => {
    const { api } = platform({ shareEmojiToGroup: async () => { throw { errMsg: 'shareEmojiToGroup:fail cancel' } } })
    expect(await sendWorkToChat(work, api)).toEqual({ ok: false, reason: 'cancelled' })
  })

  it('fails closed when the current API category cannot be read', async () => {
    const { api, calls } = platform({ getApiCategory: async () => { throw new Error('unavailable') } })
    expect(await sendWorkToChat(work, api)).toEqual({ ok: false, reason: 'unsupported' })
    expect(calls).toEqual([])
  })
})

describe('native emoji chat adapter', () => {
  it('uses callbacks for chat selection and sends an emoji without a private page entrance', async () => {
    const calls: string[] = []
    const native: NativeEmojiApi = {
      getApiCategory: () => 'default',
      enterChatToolMode(options) {
        expect(this).toBe(native)
        expect(options.singleChatRoom).toBe(true)
        calls.push('select-chat')
        options.success()
      },
      shareEmojiToGroup(options) {
        expect(this).toBe(native)
        expect(options.imagePath).toBe('/tmp/result.gif')
        expect(options.needShowEntrance).toBe(false)
        calls.push('send-emoji')
        options.success()
      },
    }
    const api = createEmojiChatPlatform(native, async (url) => {
      expect(url).toBe('https://temporary.example/result.gif')
      calls.push('download')
      return { tempFilePath: '/tmp/result.gif', statusCode: 200 }
    })

    expect(await sendWorkToChat(work, api)).toEqual({ ok: true })
    expect(calls).toEqual(['download', 'select-chat', 'send-emoji'])
  })

  it('reports unsupported outside WeChat without downloading', async () => {
    const api = createEmojiChatPlatform(undefined, async () => { throw new Error('must not download') })
    expect(await sendWorkToChat(work, api)).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('propagates a native callback failure as cancellation', async () => {
    const api = createEmojiChatPlatform({
      getApiCategory: () => 'chatTool',
      shareEmojiToGroup: (options) => options.fail({ errMsg: 'shareEmojiToGroup:fail cancel' }),
    }, async () => ({ tempFilePath: '/tmp/result.gif', statusCode: 200 }))
    expect(await sendWorkToChat(work, api)).toEqual({ ok: false, reason: 'cancelled' })
  })
})
