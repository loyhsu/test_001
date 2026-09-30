import type { EditorState, FailureCode, Work } from '../../domain/contracts'
import { initialEditorState } from '../editor/editor-state'

export type GenerationPhase = 'idle' | 'uploading' | 'processing' | 'ready' | 'failed'

export interface GenerationState {
  phase: GenerationPhase
  requestId?: string
  editorState: EditorState
  canRetry: boolean
  failureCode?: FailureCode
  work?: Work
  retryPhase?: 'uploading' | 'processing'
}

export type GenerationAction =
  | { type: 'submit'; requestId: string; editorState: EditorState }
  | { type: 'uploaded' }
  | { type: 'processing' }
  | { type: 'ready'; work: Work }
  | { type: 'failed'; code: FailureCode }
  | { type: 'retry' }
  | { type: 'reset'; editorState: EditorState }
  | { type: 'return-to-editor'; editorState: EditorState }

export const initialState: GenerationState = {
  phase: 'idle',
  editorState: initialEditorState,
  canRetry: false,
}

export function requestIdFromRandomValues(randomValues: ArrayLike<number>): string {
  const bytes = Array.from(randomValues).slice(0, 16)
  if (bytes.length !== 16) throw new Error('A request UUID requires 16 random bytes')
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const NON_RETRYABLE_FAILURES = new Set<FailureCode>([
  'INVALID_IMAGE',
  'IMAGE_TOO_LARGE',
  'IMAGE_TOO_SMALL',
  'MODERATION_REJECTED',
  'SUBJECT_NOT_FOUND',
  'SUBJECT_EXPIRED',
])

export function transition(state: GenerationState, action: GenerationAction): GenerationState {
  switch (action.type) {
    case 'submit':
      if (state.phase !== 'idle') return state
      return {
        phase: 'uploading',
        requestId: action.requestId,
        editorState: action.editorState,
        canRetry: false,
      }
    case 'uploaded':
      return state.phase === 'uploading' ? { ...state, phase: 'processing' } : state
    case 'processing':
      return state.phase === 'uploading' ? { ...state, phase: 'processing' } : state
    case 'ready':
      return state.phase === 'processing'
        ? { ...state, phase: 'ready', canRetry: false, failureCode: undefined, work: action.work }
        : state
    case 'failed':
      if (state.phase !== 'uploading' && state.phase !== 'processing') return state
      return {
        ...state,
        phase: 'failed',
        failureCode: action.code,
        canRetry: !NON_RETRYABLE_FAILURES.has(action.code),
        retryPhase: state.phase,
        work: undefined,
      }
    case 'retry':
      if (state.phase !== 'failed' || !state.canRetry) return state
      return {
        ...state,
        phase: state.retryPhase ?? 'processing',
        canRetry: false,
        failureCode: undefined,
        work: undefined,
      }
    case 'reset':
    case 'return-to-editor':
      return { phase: 'idle', editorState: action.editorState, canRetry: false }
  }
}
