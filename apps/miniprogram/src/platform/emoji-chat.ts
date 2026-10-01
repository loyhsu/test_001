import type { Work } from '../domain/contracts'

export interface EmojiChatPlatform {
  getApiCategory(): Promise<string>
  downloadFile(url: string): Promise<{ tempFilePath?: string; statusCode?: number }>
  enterChatToolMode?: () => Promise<unknown>
  shareEmojiToGroup?: (imagePath: string) => Promise<unknown>
}

export type EmojiSendResult =
  | { ok: true }
  | { ok: false; reason: 'missing-result' | 'unsupported' | 'download-failed' | 'cancelled' | 'send-failed' }

interface NativeCallbacks {
  success(): void
  fail(error: unknown): void
}

export interface NativeEmojiApi {
  getApiCategory?: () => string
  enterChatToolMode?: (options: NativeCallbacks & { singleChatRoom: boolean }) => void
  shareEmojiToGroup?: (options: NativeCallbacks & { imagePath: string; needShowEntrance: boolean }) => void
}

export function createEmojiChatPlatform(
  native: NativeEmojiApi | undefined,
  downloadFile: EmojiChatPlatform['downloadFile'],
): EmojiChatPlatform {
  return {
    getApiCategory: async () => native?.getApiCategory?.() ?? 'default',
    downloadFile,
    enterChatToolMode: native?.enterChatToolMode
      ? () => new Promise<void>((resolve, reject) => {
        native.enterChatToolMode!({ singleChatRoom: true, success: resolve, fail: reject })
      })
      : undefined,
    shareEmojiToGroup: native?.shareEmojiToGroup
      ? (imagePath) => new Promise<void>((resolve, reject) => {
        // Do not attach an entrance to the owner's private result page.
        native.shareEmojiToGroup!({ imagePath, needShowEntrance: false, success: resolve, fail: reject })
      })
      : undefined,
  }
}

export async function sendWorkToChat(
  work: Work,
  platform: EmojiChatPlatform,
  operation: { isActive?: () => boolean; onNativeFlow?: () => void } = {},
): Promise<EmojiSendResult> {
  const isActive = () => operation.isActive?.() ?? true
  if (!isActive()) return { ok: false, reason: 'cancelled' }
  if (work.status !== 'ready' || !work.resultUrl) return { ok: false, reason: 'missing-result' }
  if (!platform.shareEmojiToGroup) return { ok: false, reason: 'unsupported' }

  let category: string
  try {
    category = await platform.getApiCategory()
  } catch {
    return { ok: false, reason: 'unsupported' }
  }
  if (!isActive()) return { ok: false, reason: 'cancelled' }
  if (category !== 'chatTool' && !platform.enterChatToolMode) return { ok: false, reason: 'unsupported' }

  let imagePath: string
  try {
    const downloaded = await platform.downloadFile(work.resultUrl)
    if (!downloaded.tempFilePath || (
      downloaded.statusCode !== undefined && (downloaded.statusCode < 200 || downloaded.statusCode >= 300)
    )) return { ok: false, reason: 'download-failed' }
    imagePath = downloaded.tempFilePath
  } catch {
    return { ok: false, reason: 'download-failed' }
  }

  try {
    if (!isActive()) return { ok: false, reason: 'cancelled' }
    operation.onNativeFlow?.()
    if (!isActive()) return { ok: false, reason: 'cancelled' }
    if (category !== 'chatTool') await platform.enterChatToolMode!()
    if (!isActive()) return { ok: false, reason: 'cancelled' }
    await platform.shareEmojiToGroup(imagePath)
    return { ok: true }
  } catch (error) {
    const value = error as { errMsg?: string; message?: string } | undefined
    return { ok: false, reason: /\bcancel(?:led)?\b/i.test(value?.errMsg ?? value?.message ?? '') ? 'cancelled' : 'send-failed' }
  }
}
