import { normalizeEditorState, type EditorState, type Speed } from '../../domain/contracts'

export const initialEditorState: EditorState = {
  x: 240,
  y: 278,
  scale: 1,
  speed: 'standard',
  backgroundId: 'template',
}

export function getPhotoSelectionActionLabel(hasSourceImage: boolean): string {
  return hasSourceImage ? '更换照片' : '选择照片'
}

export function scaleFromSliderValue(value: number): number {
  return value / 100
}

export type EditorAction =
  | { type: 'move'; x: number; y: number }
  | { type: 'scale'; scale: number }
  | { type: 'speed'; speed: Speed }
  | { type: 'background'; backgroundId: EditorState['backgroundId'] }
  | { type: 'replace-source' }

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'replace-source') return { ...initialEditorState }
  if (action.type === 'move') {
    return normalizeEditorState({ ...state, x: action.x, y: action.y })
  }
  if (action.type === 'scale') {
    return normalizeEditorState({ ...state, scale: action.scale })
  }
  if (action.type === 'background') {
    return normalizeEditorState({ ...state, backgroundId: action.backgroundId })
  }
  return normalizeEditorState({ ...state, speed: action.speed })
}
