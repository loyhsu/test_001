import type { Work } from '../domain/contracts'

export interface AlbumPlatform {
  getSetting(): Promise<{ authSetting: Record<string, boolean | undefined> }>
  authorize(): Promise<unknown>
  downloadFile(url: string): Promise<{ tempFilePath?: string; statusCode?: number }>
  saveImageToPhotosAlbum(filePath: string): Promise<unknown>
}

export type AlbumSaveResult =
  | { ok: true }
  | { ok: false; reason: 'missing-result' | 'permission-denied' | 'download-failed' | 'save-failed' }

function isPermissionError(error: unknown): boolean {
  const value = error as { errMsg?: string; message?: string } | undefined
  return /authorize|auth deny|scope\.writePhotosAlbum/i.test(value?.errMsg ?? value?.message ?? '')
}

export async function saveWorkToAlbum(
  work: Work,
  platform: AlbumPlatform,
): Promise<AlbumSaveResult> {
  if (work.status !== 'ready' || !work.resultUrl) return { ok: false, reason: 'missing-result' }

  let authorized: boolean | undefined
  try {
    authorized = (await platform.getSetting()).authSetting['scope.writePhotosAlbum']
  } catch {
    return { ok: false, reason: 'permission-denied' }
  }

  if (authorized === false) return { ok: false, reason: 'permission-denied' }
  if (authorized !== true) {
    try {
      await platform.authorize()
    } catch {
      return { ok: false, reason: 'permission-denied' }
    }
  }

  let filePath: string
  try {
    const downloaded = await platform.downloadFile(work.resultUrl)
    if (
      !downloaded.tempFilePath ||
      (downloaded.statusCode !== undefined && (downloaded.statusCode < 200 || downloaded.statusCode >= 300))
    ) {
      return { ok: false, reason: 'download-failed' }
    }
    filePath = downloaded.tempFilePath
  } catch {
    return { ok: false, reason: 'download-failed' }
  }

  try {
    await platform.saveImageToPhotosAlbum(filePath)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: isPermissionError(error) ? 'permission-denied' : 'save-failed' }
  }
}
