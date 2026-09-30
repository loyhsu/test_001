import type { Template } from '../../domain/contracts'
import { TEMPLATE_CATALOG } from '../../generated/template-catalog'
import { BACKGROUND_PRESETS, type BackgroundPresetId } from '../../generated/background-presets'

import patHeadBackground from '../../assets/templates/pat-head-background.png'
import patHeadAnimationPreview from '../../assets/templates/pat-head-preview.gif'
import patHeadForeground from '../../assets/templates/pat-head-foreground.gif'
import catCry from '../../assets/mock/cat-cry.jpg'
import catKiss from '../../assets/mock/cat-kiss.jpg'
import catPatHead from '../../assets/mock/cat-pat-head.jpg'
import catShakeHead from '../../assets/mock/cat-shake-head.jpg'
import catSlap from '../../assets/mock/cat-slap.jpg'
import catSource from '../../assets/mock/cat-source.jpg'
import catSpeechless from '../../assets/mock/cat-speechless.jpg'

export type TemplateCategory = Template['category']

export interface TemplateDisplay extends Template {
  previewImage: string
  summary: string
  photoTip: string
}

export type TemplateDetailPreview =
  | { kind: 'animation'; src: string; mode: 'aspectFit'; note: string }
  | { kind: 'photo'; src: string; mode: 'aspectFill'; note: string }

export type EditorCanvasPreview =
  | { kind: 'photo'; src: string }
  | {
      kind: 'composition'
      photoSrc: string
      backgroundSrc?: string
      backgroundColor?: string
      animationSrc?: string
      note: string
    }
  | { kind: 'unavailable'; note: string }

const previewImages: Record<string, string> = {
  'pat-head': catPatHead,
  'shake-head': catShakeHead,
  slap: catSlap,
  kiss: catKiss,
  cry: catCry,
  speechless: catSpeechless,
}

const summaries: Record<string, string> = {
  'pat-head': '轻轻摸摸头，乖一点',
  'shake-head': '摇头拒绝，表达态度',
  slap: '轻轻碰一下，做个趣味互动',
  kiss: '贴贴一下，表达亲昵',
  cry: '委屈巴巴的情绪表达',
  speechless: '不用多说，一眼无语',
}

export const TEMPLATE_ITEMS: TemplateDisplay[] = TEMPLATE_CATALOG.map((template) => ({
  ...template,
  previewImage: previewImages[template.id] ?? catSource,
  summary: summaries[template.id] ?? '把照片做成聊天表情',
  photoTip: '正脸清晰、光线均匀，主体不要被遮挡，效果会更自然。',
}))

export const TEMPLATE_CATEGORIES: Array<{ id: TemplateCategory | 'popular' | 'all'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'popular', label: '热门' },
  { id: 'funny', label: '搞笑' },
  { id: 'interaction', label: '互动' },
  { id: 'emotion', label: '情绪' },
]

export const FEATURED_TEMPLATES = TEMPLATE_ITEMS.slice(0, 3)

export function getTemplateInfo(templateId?: string): TemplateDisplay {
  return TEMPLATE_ITEMS.find((template) => template.id === templateId) ?? TEMPLATE_ITEMS[0]
}

export function getTemplatePhoto(templateId?: string): string {
  return templateId === 'pat-head' ? catSource : getTemplateInfo(templateId).previewImage
}

export function getTemplateDetailPreview(templateId?: string): TemplateDetailPreview {
  const template = getTemplateInfo(templateId)
  if (template.id === 'pat-head') {
    return {
      kind: 'animation',
      src: patHeadAnimationPreview,
      mode: 'aspectFit',
      note: '动作示范，尚未叠加你的照片',
    }
  }

  return {
    kind: 'photo',
    src: template.previewImage,
    mode: 'aspectFill',
    note: '当前预览使用演示照片',
  }
}

export function getEditorCanvasPreview(
  templateId: string | undefined,
  sourcePhoto: string | undefined,
  hasTransparentSubject: boolean,
  showingActionPreview: boolean,
  backgroundId: BackgroundPresetId = 'template',
): EditorCanvasPreview {
  if (!hasTransparentSubject) {
    return { kind: 'photo', src: sourcePhoto || getTemplatePhoto(templateId) }
  }

  if (getTemplateInfo(templateId).id !== 'pat-head') {
    return showingActionPreview
      ? { kind: 'unavailable', note: '该模板暂未提供动图动作示范' }
      : { kind: 'photo', src: sourcePhoto || getTemplatePhoto(templateId) }
  }

  const preset = BACKGROUND_PRESETS.find((item) => item.id === backgroundId)
    ?? BACKGROUND_PRESETS[0]
  return {
    kind: 'composition',
    photoSrc: sourcePhoto || getTemplatePhoto(templateId),
    backgroundSrc: preset.id === 'template' ? patHeadBackground : undefined,
    backgroundColor: preset.color ?? undefined,
    animationSrc: showingActionPreview ? patHeadForeground : undefined,
    note: showingActionPreview
      ? '透明主体、背景与摸头动作合成预览'
      : '主体已抠出；可拖动、缩放并切换背景',
  }
}
