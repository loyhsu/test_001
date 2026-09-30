import { Button, Image, MovableArea, MovableView, Slider, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getSafeAreaTopPadding } from '../../platform/safe-area'
import { useEffect, useReducer, useRef, useState } from 'react'

import {
  clearPendingGeneration,
  clearPreparedPhoto,
  getPendingGeneration,
  getPreparedPhoto,
  getSelectedImage,
  setPendingGeneration,
  setPreparedPhoto,
  setSelectedImage,
} from '../../features/editor/creation-store'
import {
  editorReducer,
  getPhotoSelectionActionLabel,
  initialEditorState,
  scaleFromSliderValue,
} from '../../features/editor/editor-state'
import { getEditorBackDestination } from '../../features/editor/editor-navigation'
import { canvasCenterToMovableOffset, movableOffsetToCanvasCenter } from '../../features/editor/editor-coordinates'
import { initialState as initialGenerationState, transition as generationTransition } from '../../features/generation/generation-state'
import {
  getEditorCanvasPreview,
  getTemplateDetailPreview,
  getTemplateInfo,
} from '../../features/templates/template-data'
import { chooseSourceImage, imageSelectionMessage } from '../../platform/media'
import { createRequestId } from '../../platform/request-id'
import { track } from '../../services/analytics-runtime'
import { BACKGROUND_PRESETS } from '../../generated/background-presets'
import { preparePhoto } from '../../services/photo-preparation'
import { WorkApiError, workApi } from '../../services/work-api'

import './index.scss'

const SPEEDS = [
  { id: 'slow', label: '慢一点' },
  { id: 'standard', label: '刚刚好' },
  { id: 'fast', label: '快一点' },
] as const

type PreparationPhase = 'idle' | 'processing' | 'ready' | 'failed'

function preparationErrorMessage(error: unknown): string {
  const code = error instanceof WorkApiError ? error.code : ''
  if (code === 'MODERATION_REJECTED') return '这张照片暂时无法用于制作，请换一张照片'
  if (code === 'SUBJECT_NOT_FOUND') return '没有识别到清晰主体，请换一张照片试试'
  if (code === 'IMAGE_TOO_LARGE') return '照片超过大小限制，请换一张照片'
  if (code === 'IMAGE_TOO_SMALL') return '照片分辨率不足，请换一张更清晰的照片'
  if (code === 'INVALID_IMAGE') return '照片无法读取，请重新选择'
  return '照片处理暂时没有成功，可以重试或更换照片'
}

export default function EditorPage() {
  const params = Taro.getCurrentInstance().router?.params ?? {}
  const template = getTemplateInfo(String(params.templateId ?? 'pat-head'))
  const [editorState, dispatch] = useReducer(editorReducer, initialEditorState)
  const [generationState, dispatchGeneration] = useReducer(generationTransition, initialGenerationState)
  const [sourceImage, setSourceImage] = useState(getSelectedImage())
  const [preparedPhoto, setPreparedPhotoState] = useState(getPreparedPhoto())
  const [preparationPhase, setPreparationPhase] = useState<PreparationPhase>(
    preparedPhoto ? 'ready' : 'idle',
  )
  const [preparationMessage, setPreparationMessage] = useState('')
  const [showingActionPreview, setShowingActionPreview] = useState(false)
  const submitLock = useRef(false)
  const editorStateRef = useRef(editorState)
  const photoRequestVersion = useRef(0)
  editorStateRef.current = editorState
  const viewportWidth = Taro.getSystemInfoSync().windowWidth || 375
  const [areaSize, setAreaSize] = useState(() => ({
    width: viewportWidth * 480 / 750,
    height: viewportWidth * 480 / 750,
  }))
  const canvasPreview = getEditorCanvasPreview(
    template.id,
    preparedPhoto?.subjectUrl ?? sourceImage?.path,
    Boolean(preparedPhoto),
    showingActionPreview,
    editorState.backgroundId,
  )
  const hasMotionPreview = getTemplateDetailPreview(template.id).kind === 'animation'

  const prepareSelectedPhoto = async (image: NonNullable<typeof sourceImage>) => {
    const version = ++photoRequestVersion.current
    clearPreparedPhoto()
    setPreparedPhotoState(undefined)
    setPreparationPhase('processing')
    setPreparationMessage('')

    try {
      const requestId = await createRequestId()
      const prepared = await preparePhoto(image, requestId, {
        createUploadTicket: workApi.createUploadTicket,
        uploadFile: async (cloudPath, localPath) => {
          if (!Taro.cloud?.uploadFile) throw new WorkApiError('NETWORK_ERROR')
          const uploaded = await Taro.cloud.uploadFile({ cloudPath, filePath: localPath })
          return uploaded.fileID
        },
        prepareSubject: workApi.prepareSubject,
      })
      if (version !== photoRequestVersion.current || getSelectedImage()?.path !== image.path) return
      setPreparedPhoto(prepared)
      setPreparedPhotoState(prepared)
      setPreparationPhase('ready')
    } catch (error) {
      if (version !== photoRequestVersion.current || getSelectedImage()?.path !== image.path) return
      setPreparationPhase('failed')
      setPreparationMessage(preparationErrorMessage(error))
    }
  }

  const refreshPreparedPreview = async (photo: NonNullable<typeof preparedPhoto>) => {
    const version = ++photoRequestVersion.current
    if (Date.parse(photo.expiresAt) <= Date.now()) {
      clearPreparedPhoto()
      setPreparedPhotoState(undefined)
      setPreparationPhase('failed')
      setPreparationMessage('临时处理文件已过期，请重新选择照片')
      return
    }

    try {
      const preview = await workApi.prepareSubject({
        requestId: photo.requestId,
        uploadTicketId: photo.uploadTicket.uploadTicketId,
        sourceFileId: photo.sourceFileId,
      })
      const current = getPreparedPhoto()
      if (
        version !== photoRequestVersion.current ||
        current?.requestId !== photo.requestId ||
        getSelectedImage()?.path !== photo.image.path
      ) return
      const refreshed = { ...photo, ...preview }
      setPreparedPhoto(refreshed)
      setPreparedPhotoState(refreshed)
      setPreparationPhase('ready')
      setPreparationMessage('')
    } catch (error) {
      if (version !== photoRequestVersion.current || getSelectedImage()?.path !== photo.image.path) return
      clearPreparedPhoto()
      setPreparedPhotoState(undefined)
      setPreparationPhase('failed')
      setPreparationMessage(preparationErrorMessage(error))
    }
  }

  Taro.useDidShow(() => {
    submitLock.current = false
    dispatchGeneration({ type: 'return-to-editor', editorState: editorStateRef.current })
    if (getPendingGeneration()?.sourceWorkId) return
    const currentPreparedPhoto = getPreparedPhoto()
    if (currentPreparedPhoto) void refreshPreparedPreview(currentPreparedPhoto)
  })

  useEffect(() => {
    void track('editor_view', { templateId: template.id })
    try {
      Taro.nextTick(() => {
        Taro.createSelectorQuery()
          .select('.editor-movable-area')
          .boundingClientRect((rect) => {
            const measured = Array.isArray(rect) ? rect[0] : rect
            if (measured?.width && measured.height) {
              setAreaSize({ width: measured.width, height: measured.height })
            }
          })
          .exec()
      })
    } catch {
      // Keep the square-canvas fallback dimensions when selector queries are unavailable.
    }
    if (sourceImage && !getPreparedPhoto()) void prepareSelectedPhoto(sourceImage)
  }, [])

  const choosePhoto = async () => {
    void track('photo_select_start', { templateId: template.id })
    try {
      const image = await chooseSourceImage()
      void track('photo_select_success', {
        templateId: template.id,
        sizeKb: Math.round(image.size / 1024),
      })
      clearPendingGeneration()
      setSelectedImage(image)
      setSourceImage(image)
      setShowingActionPreview(false)
      dispatch({ type: 'replace-source' })
      dispatchGeneration({ type: 'reset', editorState: initialEditorState })
      void prepareSelectedPhoto(image)
    } catch (error) {
      const message = imageSelectionMessage(error)
      if (message) Taro.showToast({ title: message, icon: 'none' })
    }
  }

  const startGeneration = async () => {
    if (submitLock.current || generationState.phase !== 'idle') return
    if (!preparedPhoto) {
      Taro.showToast({ title: sourceImage ? '照片还在处理中，请稍候' : '请先选择一张照片', icon: 'none' })
      return
    }
    if (Date.parse(preparedPhoto.expiresAt) <= Date.now()) {
      clearPreparedPhoto()
      setPreparedPhotoState(undefined)
      setPreparationPhase('failed')
      setPreparationMessage('临时处理文件已过期，请重新选择照片')
      return
    }

    submitLock.current = true
    try {
      const requestId = preparedPhoto.requestId
      dispatchGeneration({ type: 'submit', requestId, editorState })
      setPendingGeneration({
        requestId,
        templateId: template.id,
        editorState,
        sourceImage,
        sourceFileId: preparedPhoto.sourceFileId,
        uploadTicket: preparedPhoto.uploadTicket,
      })
      await Taro.navigateTo({ url: '/pages/processing/index' })
    } catch {
      submitLock.current = false
      Taro.showToast({ title: '暂时无法开始制作，请重试', icon: 'none' })
    }
  }

  const movableOffset = canvasCenterToMovableOffset(
    editorState,
    editorState.scale,
    areaSize,
    viewportWidth,
  )
  const updateScaleFromSlider = (value: number) => {
    dispatch({ type: 'scale', scale: scaleFromSliderValue(value) })
  }
  const movableSize = Math.min(areaSize.width, areaSize.height) * 0.55
  const canvasStyle = canvasPreview.kind === 'composition' && canvasPreview.backgroundColor
    ? { backgroundColor: canvasPreview.backgroundColor }
    : undefined
  const handleBack = () => {
    if (getEditorBackDestination(Taro.getCurrentPages().length) === 'previous-page') {
      Taro.navigateBack({
        fail: () => {
          void Taro.redirectTo({ url: `/pages/template-detail/index?templateId=${template.id}` })
        },
      })
      return
    }

    void Taro.redirectTo({ url: `/pages/template-detail/index?templateId=${template.id}` })
  }

  return (
    <View
      className="screen editor-screen"
      style={{ paddingTop: getSafeAreaTopPadding(Taro.getSystemInfoSync().statusBarHeight) }}
    >
      <View className="page-topbar">
        <Text className="page-topbar__back" onClick={handleBack}>返回</Text>
        <Text className="page-topbar__title">制作表情</Text>
        <View className="page-topbar__spacer" />
      </View>

      <View className="editor-heading">
        <View>
          <Text className="editor-heading__title">调整照片</Text>
          <Text className="editor-heading__copy">拖动主体，缩放到合适位置</Text>
        </View>
        <View className="editor-template-pill">
          <Image src={template.previewImage} mode="aspectFill" />
          <Text>{template.name}</Text>
        </View>
      </View>

      <View className="editor-canvas" style={canvasStyle}>
        <View className="editor-canvas__badge">
          <Text>
            {canvasPreview.kind === 'composition'
              ? showingActionPreview ? '动作合成预览' : '透明主体预览'
              : preparationPhase === 'processing' ? '正在提取主体'
              : sourceImage ? '已选照片' : '演示照片 · 先选一张照片'}
          </Text>
        </View>
        <View
          className={`editor-canvas__preview-toggle ${hasMotionPreview && preparedPhoto ? '' : 'editor-canvas__preview-toggle--disabled'}`}
          onClick={() => hasMotionPreview && preparedPhoto && setShowingActionPreview((value) => !value)}
        >
          <Text>
            {hasMotionPreview && preparedPhoto
              ? showingActionPreview ? '隐藏动作' : '预览动作'
            : '暂无动图预览'}
          </Text>
        </View>
        {canvasPreview.kind === 'composition' && canvasPreview.backgroundSrc && (
          <Image
            className="editor-composition-background"
            src={canvasPreview.backgroundSrc}
            mode="aspectFill"
          />
        )}
        {(canvasPreview.kind === 'photo' || canvasPreview.kind === 'composition') && (
          <MovableArea className="editor-movable-area">
            <MovableView
              className="editor-movable-view"
              style={{ width: `${movableSize}px`, height: `${movableSize}px` }}
              direction="all"
              x={movableOffset.x}
              y={movableOffset.y}
              scale
              scaleMin={0.65}
              scaleMax={1.6}
              scaleValue={editorState.scale}
              onChange={(event) => {
                const center = movableOffsetToCanvasCenter(
                  { x: event.detail.x, y: event.detail.y },
                  editorState.scale,
                  areaSize,
                  viewportWidth,
                )
                dispatch({ type: 'move', ...center })
              }}
              onScale={(event) => dispatch({ type: 'scale', scale: event.detail.scale })}
            >
              <Image
                className="editor-photo"
                src={canvasPreview.kind === 'composition' ? canvasPreview.photoSrc : canvasPreview.src}
                mode="aspectFit"
              />
            </MovableView>
          </MovableArea>
        )}
        {canvasPreview.kind === 'composition' && canvasPreview.animationSrc && (
          <Image
            className="editor-motion-overlay"
            src={canvasPreview.animationSrc}
            mode="aspectFill"
          />
        )}
        {canvasPreview.kind === 'unavailable' && (
          <View className="editor-preview-unavailable"><Text>{canvasPreview.note}</Text></View>
        )}
      </View>
      {canvasPreview.kind === 'composition' && (
        <Text className="editor-preview-note">{canvasPreview.note}</Text>
      )}

      <View className="editor-backgrounds">
        <View className="control-heading">
          <Text className="control-heading__title">背景</Text>
          <Text className="control-heading__hint">生成时同步使用</Text>
        </View>
        <View className="background-options">
          {BACKGROUND_PRESETS.map((preset) => (
            <View
              key={preset.id}
              className={`background-option ${editorState.backgroundId === preset.id ? 'background-option--active' : ''}`}
              onClick={() => dispatch({ type: 'background', backgroundId: preset.id })}
            >
              <View
                className={`background-option__swatch ${preset.id === 'template' ? 'background-option__swatch--template' : ''}`}
                style={preset.color ? { backgroundColor: preset.color } : undefined}
              />
              <Text>{preset.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {sourceImage && (
        <View className={`editor-preparation editor-preparation--${preparationPhase}`}>
          <Text>
            {preparationPhase === 'processing' ? '正在安全上传并提取透明主体…'
              : preparationPhase === 'ready' ? '主体已准备好，可以调整位置和背景'
              : preparationPhase === 'failed' ? preparationMessage
              : '照片准备后即可预览实际合成效果'}
          </Text>
          {preparationPhase === 'failed' && (
            <Text className="editor-preparation__retry" onClick={() => void prepareSelectedPhoto(sourceImage)}>
              重新处理这张照片
            </Text>
          )}
        </View>
      )}

      <View className="editor-controls">
        <View className="control-heading">
          <Text className="control-heading__title">主体大小</Text>
          <Text className="control-heading__value">{Math.round(editorState.scale * 100)}%</Text>
        </View>
        <Slider
          className="editor-scale-slider"
          min={65}
          max={160}
          value={Math.round(editorState.scale * 100)}
          activeColor="#3277f6"
          backgroundColor="#e8edf5"
          blockColor="#ffffff"
          blockSize={22}
          onChange={(event) => updateScaleFromSlider(event.detail.value)}
          onChanging={(event) => updateScaleFromSlider(event.detail.value)}
        />

        <View className="control-heading editor-speed-heading">
          <Text className="control-heading__title">动图速度</Text>
          <Text className="control-heading__hint">可随时调整</Text>
        </View>
        <View className="speed-options">
          {SPEEDS.map((item) => (
            <View
              key={item.id}
              className={`speed-option ${editorState.speed === item.id ? 'speed-option--active' : ''}`}
              onClick={() => dispatch({ type: 'speed', speed: item.id })}
            >
              <Text>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className="editor-actions">
        <Button className="subtle-button editor-choose" onClick={choosePhoto}>
          {getPhotoSelectionActionLabel(Boolean(sourceImage))}
        </Button>
        <Button
          className="primary-button editor-generate"
          disabled={!sourceImage || !preparedPhoto || preparationPhase !== 'ready' || generationState.phase !== 'idle'}
          onClick={startGeneration}
        >
          生成表情
        </Button>
        <Text className="editor-disclaimer">原图仅用于本次制作，临时保留约 24 小时</Text>
      </View>
    </View>
  )
}
