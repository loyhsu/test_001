import { describe, expect, it } from 'vitest'

import {
  initialState,
  requestIdFromRandomValues,
  transition,
  type GenerationState,
} from './generation-state'

const editorState = { x: 240, y: 278, scale: 1, speed: 'standard' as const, backgroundId: 'template' as const }

const runningState: GenerationState = transition(initialState, {
  type: 'submit',
  requestId: 'request-1',
  editorState,
})

describe('generation state transitions', () => {
  it('formats secure random bytes as an RFC 4122 version 4 UUID', () => {
    expect(requestIdFromRandomValues(new Uint8Array(16))).toBe(
      '00000000-0000-4000-8000-000000000000',
    )
  })

  it('ignores a second submit while one request is running', () => {
    const next = transition(runningState, {
      type: 'submit',
      requestId: 'request-2',
      editorState,
    })

    expect(next).toBe(runningState)
    expect(next.requestId).toBe('request-1')
  })

  it('keeps editor state after a retryable network failure', () => {
    const failed = transition(runningState, { type: 'failed', code: 'NETWORK_ERROR' })

    expect(failed.editorState).toEqual(editorState)
    expect(failed.canRetry).toBe(true)
    expect(failed.requestId).toBe('request-1')
  })

  it('does not offer another retry after the private cutout has expired', () => {
    const processing = transition(runningState, { type: 'uploaded' })
    const failed = transition(processing, { type: 'failed', code: 'SUBJECT_EXPIRED' })

    expect(failed.canRetry).toBe(false)
    expect(transition(failed, { type: 'retry' })).toBe(failed)
  })

  it('moves from upload through processing to a ready work', () => {
    const processing = transition(runningState, { type: 'uploaded' })
    const work = {
      id: 'work-12345678',
      templateId: 'pat-head',
      status: 'ready' as const,
      editorState,
      createdAt: '2026-09-24T00:00:00.000Z',
      expiresAt: '2026-10-24T00:00:00.000Z',
    }
    const ready = transition(processing, { type: 'ready', work })

    expect(processing.phase).toBe('processing')
    expect(ready.phase).toBe('ready')
    expect(ready.work).toEqual(work)
    expect(ready.canRetry).toBe(false)
  })

  it('retries a failed generation with the same request and editor state', () => {
    const processing = transition(runningState, { type: 'uploaded' })
    const failed = transition(processing, { type: 'failed', code: 'NETWORK_ERROR' })
    const retrying = transition(failed, { type: 'retry' })

    expect(retrying.phase).toBe('processing')
    expect(retrying.requestId).toBe('request-1')
    expect(retrying.editorState).toEqual(editorState)
    expect(retrying.canRetry).toBe(false)
  })

  it('unlocks generation when returning to the editor with its current adjustments', () => {
    const adjustedEditorState = { ...editorState, scale: 1.35, speed: 'fast' as const }
    const resumed = transition(runningState, {
      type: 'return-to-editor',
      editorState: adjustedEditorState,
    })

    expect(resumed.phase).toBe('idle')
    expect(resumed.requestId).toBeUndefined()
    expect(resumed.editorState).toEqual(adjustedEditorState)
    expect(resumed.canRetry).toBe(false)
  })
})
