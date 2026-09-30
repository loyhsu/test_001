import Taro from '@tarojs/taro'

export interface SelectedImage {
  path: string
  size: number
  width: number
  height: number
  type: 'jpg' | 'jpeg' | 'png'
}

export type ImageSelectionErrorCode =
  | 'cancelled'
  | 'selection-failed'
  | 'invalid-image'
  | 'unsupported-format'
  | 'too-large'
  | 'too-small'

export class ImageSelectionError extends Error {
  constructor(public readonly code: ImageSelectionErrorCode) {
    super(code)
    this.name = 'ImageSelectionError'
  }
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MIN_SHORT_EDGE = 320
const ALLOWED_IMAGE_TYPES = new Set(['jpg', 'jpeg', 'png'])

function normalizeImageType(value: string | undefined): string {
  if (!value) return ''
  const normalized = value.toLowerCase().split('/').pop()?.split(';')[0] ?? ''
  return normalized.startsWith('.') ? normalized.slice(1) : normalized
}

function typeFromPath(path: string): string {
  const extension = path.split(/[?#]/)[0].split('.').pop()
  return normalizeImageType(extension)
}

export async function chooseSourceImage(): Promise<SelectedImage> {
  let selected: Awaited<ReturnType<typeof Taro.chooseMedia>>['tempFiles'][number]
  try {
    const result = await Taro.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
    })
    selected = result.tempFiles[0]
  } catch (error) {
    const message = String((error as { errMsg?: string; message?: string })?.errMsg ?? (error as Error)?.message ?? '')
    throw new ImageSelectionError(/cancel/i.test(message) ? 'cancelled' : 'selection-failed')
  }

  if (!selected?.tempFilePath) throw new ImageSelectionError('invalid-image')
  if (selected.size > MAX_IMAGE_BYTES) throw new ImageSelectionError('too-large')

  let imageInfo: Awaited<ReturnType<typeof Taro.getImageInfo>>
  try {
    imageInfo = await Taro.getImageInfo({ src: selected.tempFilePath })
  } catch {
    throw new ImageSelectionError('invalid-image')
  }

  const type = normalizeImageType(imageInfo.type)
    || normalizeImageType(selected.originalFileObj?.type)
    || typeFromPath(selected.tempFilePath)
  if (!ALLOWED_IMAGE_TYPES.has(type)) throw new ImageSelectionError('unsupported-format')
  if (Math.min(imageInfo.width, imageInfo.height) < MIN_SHORT_EDGE) {
    throw new ImageSelectionError('too-small')
  }

  return {
    path: imageInfo.path || selected.tempFilePath,
    size: selected.size,
    width: imageInfo.width,
    height: imageInfo.height,
    type: type as SelectedImage['type'],
  }
}

export function imageSelectionMessage(error: unknown): string | undefined {
  if (!(error instanceof ImageSelectionError)) return '选择照片失败，请稍后重试'
  switch (error.code) {
    case 'cancelled':
      return undefined
    case 'too-large':
      return '图片不能超过 10 MB，请换一张试试'
    case 'too-small':
      return '图片短边至少需要 320 像素，请换一张清晰照片'
    case 'unsupported-format':
      return '仅支持 JPG、JPEG 或 PNG 图片'
    case 'invalid-image':
      return '图片读取失败，请重新选择一张照片'
    case 'selection-failed':
      return '未能读取相册，请稍后重试'
  }
}
