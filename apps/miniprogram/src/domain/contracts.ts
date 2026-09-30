import { BACKGROUND_PRESETS, type BackgroundPresetId } from '../generated/background-presets'

export type Speed = 'slow' | 'standard' | 'fast'

export type WorkStatus = 'processing' | 'ready' | 'failed' | 'expired'

export type FailureCode =
  | 'INVALID_IMAGE'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_TOO_SMALL'
  | 'MODERATION_REJECTED'
  | 'SUBJECT_NOT_FOUND'
  | 'MATTING_FAILED'
  | 'ENCODING_FAILED'
  | 'NETWORK_ERROR'
  | 'SUBJECT_EXPIRED'

export interface EditorState {
  x: number
  y: number
  scale: number
  speed: Speed
  backgroundId: BackgroundPresetId
}

export interface Template {
  id: string
  name: string
  category: 'popular' | 'funny' | 'interaction' | 'emotion'
  previewUrl: string
  coverUrl: string
  sortOrder: number
  enabled: boolean
}

export interface Work {
  id: string
  templateId: string
  status: WorkStatus
  coverUrl?: string
  resultUrl?: string
  failureCode?: FailureCode
  outputKb?: number
  editorState: EditorState
  createdAt: string
  expiresAt: string
}

interface GenerateWorkInputBase {
  requestId: string
  templateId: string
  editorState: EditorState
}

export type GenerateWorkInput = GenerateWorkInputBase & (
      | { sourceFileId: string; uploadTicketId: string; sourceWorkId?: never }
  | { sourceWorkId: string; sourceFileId?: never; uploadTicketId?: never }
)

const supportedSpeeds: Speed[] = ['slow', 'standard', 'fast']
const supportedBackgroundIds = BACKGROUND_PRESETS.map((preset) => preset.id)

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function normalizeEditorState(input: EditorState): EditorState {
  return {
    x: clamp(input.x, 0, 480),
    y: clamp(input.y, 0, 480),
    scale: clamp(input.scale, 0.65, 1.6),
    speed: supportedSpeeds.includes(input.speed) ? input.speed : 'standard',
    backgroundId: supportedBackgroundIds.includes(input.backgroundId) ? input.backgroundId : 'template',
  }
}
