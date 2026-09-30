import { Button, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getSafeAreaTopPadding } from '../../platform/safe-area'
import { useEffect, useReducer, useRef } from 'react'

import { getPendingGeneration, updatePendingGeneration } from '../../features/editor/creation-store'
import { initialState, transition } from '../../features/generation/generation-state'
import type { FailureCode, GenerateWorkInput, Work } from '../../domain/contracts'
import { WorkApiError, workApi } from '../../services/work-api'
import { track } from '../../services/analytics-runtime'

import './index.scss'

const WAIT_MS = 1600
const MAX_POLLS = 38

function failureCode(error: unknown): FailureCode {
  const code = error instanceof WorkApiError ? error.code : ''
  if (code === 'UPLOAD_TICKET_INVALID') return 'SUBJECT_EXPIRED'
  const allowed: FailureCode[] = [
    'INVALID_IMAGE',
    'IMAGE_TOO_LARGE',
    'IMAGE_TOO_SMALL',
    'MODERATION_REJECTED',
    'SUBJECT_NOT_FOUND',
    'MATTING_FAILED',
    'ENCODING_FAILED',
    'NETWORK_ERROR',
    'SUBJECT_EXPIRED',
  ]
  return allowed.includes(code as FailureCode) ? code as FailureCode : 'NETWORK_ERROR'
}

function failureMessage(code?: FailureCode): string {
  switch (code) {
    case 'INVALID_IMAGE': return '照片无法读取，请返回重新选择'
    case 'IMAGE_TOO_LARGE': return '照片超过大小限制，请换一张照片'
    case 'IMAGE_TOO_SMALL': return '照片分辨率不足，请换一张更清晰的照片'
    case 'MODERATION_REJECTED': return '这张照片暂时无法用于制作，请换一张试试'
    case 'SUBJECT_NOT_FOUND': return '没有识别到清晰主体，请换一张照片'
    case 'SUBJECT_EXPIRED': return '临时照片处理已过期，请返回编辑器重新选择照片'
    case 'MATTING_FAILED': return '主体处理没有成功，可以再试一次'
    case 'ENCODING_FAILED': return '动图生成没有成功，可以再试一次'
    default: return '网络或服务暂时不稳定，可以再试一次'
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default function ProcessingPage() {
  const [state, dispatch] = useReducer(transition, initialState)
  const mounted = useRef(false)
  const running = useRef(false)
  const started = useRef(false)

  const openWork = async (work: Work) => {
    await Taro.redirectTo({ url: `/pages/result/index?workId=${encodeURIComponent(work.id)}` })
  }

  const createWork = async (retry = false) => {
    if (running.current) return
    const pending = getPendingGeneration()
    if (!pending) {
      Taro.showToast({ title: '制作信息已失效，请重新开始', icon: 'none' })
      await Taro.reLaunch({ url: '/pages/home/index' })
      return
    }
    running.current = true

    if (!retry) {
      dispatch({
        type: 'submit',
        requestId: pending.requestId,
        editorState: pending.editorState,
      })
    } else {
      dispatch({ type: 'retry' })
    }

    const startedAt = Date.now()
    try {
      let input: GenerateWorkInput
      if (pending.sourceWorkId) {
        input = {
          requestId: pending.requestId,
          templateId: pending.templateId,
          editorState: pending.editorState,
          sourceWorkId: pending.sourceWorkId,
        }
      } else {
        if (!pending.sourceImage) throw new WorkApiError('INVALID_IMAGE')
        let current = getPendingGeneration()
        if (!current?.sourceFileId) {
          const uploadTicket = await workApi.createUploadTicket({
            requestId: pending.requestId,
            imageType: pending.sourceImage.type,
          })
          current = updatePendingGeneration({ uploadTicket })
          if (!current) throw new WorkApiError('NETWORK_ERROR')
        }
        if (!current.sourceFileId) {
          if (!Taro.cloud?.uploadFile) throw new WorkApiError('NETWORK_ERROR')
          const uploaded = await Taro.cloud.uploadFile({
            cloudPath: current.uploadTicket!.cloudPath,
            filePath: pending.sourceImage.path,
          })
          if (!uploaded.fileID) throw new WorkApiError('NETWORK_ERROR')
          current = updatePendingGeneration({ sourceFileId: uploaded.fileID })
          if (!current) throw new WorkApiError('NETWORK_ERROR')
        }
        if (!current.uploadTicket) throw new WorkApiError('NETWORK_ERROR')
        input = {
          requestId: pending.requestId,
          templateId: pending.templateId,
          editorState: pending.editorState,
          sourceFileId: current.sourceFileId!,
          uploadTicketId: current.uploadTicket.uploadTicketId,
        }
      }

      dispatch({ type: 'processing' })
      let work = await workApi.createWork(input)
      void track('generation_start', {
        templateId: pending.templateId,
        workId: work.id,
      })
      for (let attempt = 0; work.status === 'processing' && attempt < MAX_POLLS; attempt += 1) {
        if (!mounted.current) return
        await wait(WAIT_MS)
        work = await workApi.getWork(work.id)
      }
      if (!mounted.current) return
      if (work.status === 'ready') {
        void track('generation_success', {
          templateId: pending.templateId,
          durationMs: Date.now() - startedAt,
          outputKb: work.outputKb,
        })
        await openWork(work)
      } else if (work.status === 'expired') {
        void track('generation_fail', {
          templateId: pending.templateId,
          failureCode: 'SUBJECT_EXPIRED',
        })
        await openWork(work)
      } else if (work.status === 'failed') {
        void track('generation_fail', {
          templateId: pending.templateId,
          failureCode: work.failureCode ?? 'NETWORK_ERROR',
        })
        dispatch({ type: 'failed', code: work.failureCode ?? 'NETWORK_ERROR' })
      } else {
        dispatch({ type: 'failed', code: 'NETWORK_ERROR' })
      }
    } catch (error) {
      if (!mounted.current) return
      void track('generation_fail', {
        templateId: pending.templateId,
        failureCode: failureCode(error),
      })
      dispatch({ type: 'failed', code: failureCode(error) })
    } finally {
      running.current = false
    }
  }

  useEffect(() => {
    mounted.current = true
    if (!started.current) {
      started.current = true
      void createWork()
    }
    return () => {
      mounted.current = false
    }
  }, [])

  const returnHome = () => Taro.reLaunch({ url: '/pages/home/index' })
  const returnToPreviousPage = () => {
    Taro.navigateBack({ fail: returnHome })
  }

  return (
    <View
      className="screen processing-screen"
      style={{ paddingTop: getSafeAreaTopPadding(Taro.getSystemInfoSync().statusBarHeight) }}
    >
      <View className="page-topbar">
        <Text className="page-topbar__back" onClick={() => Taro.navigateBack()}>返回</Text>
        <Text className="page-topbar__title">制作表情</Text>
        <View className="page-topbar__spacer" />
      </View>

      {state.phase !== 'failed' ? (
        <View className="processing-content">
          <View className="processing-orbit"><View className="processing-orbit__dot" /></View>
          <Text className="processing-title">正在制作你的表情</Text>
          <Text className="processing-copy">
            {state.phase === 'uploading' ? '正在提交任务并校验照片…' : '正在合成动图…'}
          </Text>
          <View className="processing-note">
            <Text>这一步可能需要一点时间，请保持页面开启</Text>
          </View>
          <Text className="processing-privacy">原照片和中间处理文件仅临时保留，最长约 24 小时</Text>
        </View>
      ) : (
        <View className="processing-failed">
          <View className="processing-failed__icon"><Text>!</Text></View>
          <Text className="processing-title">这次没有制作成功</Text>
          <Text className="processing-copy">{failureMessage(state.failureCode)}</Text>
          <View className="processing-failed__actions">
            {state.canRetry && (
              <Button className="primary-button" onClick={() => void createWork(true)}>再试一次</Button>
            )}
            <Button
              className="subtle-button"
              onClick={state.failureCode === 'SUBJECT_EXPIRED' ? returnToPreviousPage : returnHome}
            >
              {state.canRetry
                ? '稍后再做'
                : state.failureCode === 'SUBJECT_EXPIRED' ? '返回编辑器重新选择' : '返回首页'}
            </Button>
          </View>
        </View>
      )}
    </View>
  )
}
