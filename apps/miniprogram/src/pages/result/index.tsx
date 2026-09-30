import { Button, Image, Text, View } from '@tarojs/components'
import Taro, { useShareAppMessage } from '@tarojs/taro'
import { getSafeAreaTopPadding } from '../../platform/safe-area'
import { useEffect, useRef, useState } from 'react'

import type { Work } from '../../domain/contracts'
import { setPendingGeneration } from '../../features/editor/creation-store'
import { TEMPLATE_ITEMS, getTemplateInfo } from '../../features/templates/template-data'
import { saveWorkToAlbum, type AlbumPlatform } from '../../platform/album'
import { createRequestId } from '../../platform/request-id'
import { createWorkShareMetadata } from '../../platform/share'
import { WorkApiError, workApi } from '../../services/work-api'
import { track } from '../../services/analytics-runtime'

import './index.scss'

function albumPlatform(): AlbumPlatform {
  return {
    getSetting: async () => {
      const settings = await Taro.getSetting()
      return {
        authSetting: {
          'scope.writePhotosAlbum': settings.authSetting['scope.writePhotosAlbum'],
        },
      }
    },
    authorize: () => Taro.authorize({ scope: 'scope.writePhotosAlbum' }),
    downloadFile: (url) => Taro.downloadFile({ url }),
    saveImageToPhotosAlbum: (filePath) => Taro.saveImageToPhotosAlbum({ filePath }),
  }
}

export default function ResultPage() {
  const params = Taro.getCurrentInstance().router?.params ?? {}
  const workId = String(params.workId ?? '')
  const [work, setWork] = useState<Work>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const active = useRef(false)

  const template = getTemplateInfo(work?.templateId)

  useShareAppMessage(() => work
    ? createWorkShareMetadata(work, getTemplateInfo(work.templateId).name)
    : { title: '表情工坊', path: '/pages/home/index' })

  useEffect(() => {
    active.current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      if (!workId) {
        setLoadError('没有找到这份作品')
        setLoading(false)
        return
      }
      try {
        let next = await workApi.getWork(workId)
        let attempts = 0
        while (next.status === 'processing' && attempts < 30 && active.current) {
          await new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 1800)
          })
          if (!active.current) return
          next = await workApi.getWork(workId)
          attempts += 1
        }
        if (!active.current) return
        setWork(next)
        if (next.status === 'processing') setLoadError('制作仍在继续，可以稍后刷新查看')
      } catch (error) {
        if (active.current) {
          const code = error instanceof WorkApiError ? error.code : ''
          setLoadError(code === 'NOT_FOUND' ? '作品不存在或已被删除' : '暂时无法读取作品，请检查网络后重试')
        }
      } finally {
        if (active.current) setLoading(false)
      }
    }
    void load()
    return () => {
      active.current = false
      if (timer) clearTimeout(timer)
    }
  }, [workId])

  const saveToAlbum = async () => {
    if (!work || saving) return
    setSaving(true)
    const result = await saveWorkToAlbum(work, albumPlatform())
    setSaving(false)
    if (result.ok) {
      Taro.showToast({ title: '已保存到相册', icon: 'success' })
      void track('work_save_success', { workId: work.id })
      return
    }
    if (result.reason === 'permission-denied') {
      const modal = await Taro.showModal({
        title: '需要相册权限',
        content: '请在设置中允许保存图片到相册，然后再试一次。',
        confirmText: '去设置',
        cancelText: '取消',
      })
      if (modal.confirm) await Taro.openSetting()
      return
    }
    Taro.showToast({
      title: result.reason === 'missing-result' ? '这份作品暂时不能保存' : '保存失败，请稍后重试',
      icon: 'none',
    })
  }

  const makeAnother = async (templateId: string) => {
    if (!work || starting || work.status === 'expired') return
    setStarting(true)
    try {
      const requestId = await createRequestId()
      setPendingGeneration({
        requestId,
        templateId,
        editorState: work.editorState,
        sourceWorkId: work.id,
      })
      void track('create_again_tap', {
        workId: work.id,
        nextTemplateId: templateId,
      })
      await Taro.navigateTo({ url: '/pages/processing/index' })
      setStarting(false)
    } catch {
      Taro.showToast({ title: '暂时无法开始，请稍后重试', icon: 'none' })
      setStarting(false)
    }
  }

  const retryFailed = () => {
    if (work) void makeAnother(work.templateId)
  }

  const isReady = work?.status === 'ready' && Boolean(work.resultUrl)

  return (
    <View
      className="screen result-screen"
      style={{ paddingTop: getSafeAreaTopPadding(Taro.getSystemInfoSync().statusBarHeight) }}
    >
      <View className="page-topbar">
        <Text className="page-topbar__back" onClick={() => Taro.navigateBack()}>返回</Text>
        <Text className="page-topbar__title">作品详情</Text>
        <View className="page-topbar__spacer" />
      </View>

      {loading ? (
        <View className="result-message"><Text>正在读取作品…</Text></View>
      ) : loadError && !work ? (
        <View className="result-message">
          <Text className="result-message__title">暂时打不开</Text>
          <Text className="result-message__copy">{loadError}</Text>
          <Button className="subtle-button result-message__button" onClick={() => Taro.navigateBack()}>返回</Button>
        </View>
      ) : work?.status === 'ready' ? (
        <>
          <View className="result-heading">
            <Text className="result-heading__title">做好啦</Text>
            <Text className="result-heading__copy">{template.name} · 动图作品</Text>
          </View>
          <View className="result-preview">
            {work.resultUrl
              ? <Image className="result-preview__image" src={work.resultUrl} mode="aspectFit" />
              : <View className="result-preview__missing"><Text>作品文件暂时不可用</Text></View>}
            <View className="result-preview__tag"><Text>GIF 动图</Text></View>
          </View>

          {loadError && <Text className="result-inline-note">{loadError}</Text>}

          <View className="result-actions">
            <Button className="primary-button" disabled={!isReady || saving} onClick={saveToAlbum}>
              {saving ? '正在保存…' : '保存到手机相册'}
            </Button>
            <Button
              className="subtle-button result-share"
              openType="share"
              onClick={() => {
                if (work) void track('work_share_tap', {
                  workId: work.id,
                  templateId: work.templateId,
                })
              }}
            >分享给朋友</Button>
          </View>

          <View className="result-retention">
            <Text>作品将在 {new Date(work.expiresAt).toLocaleDateString()} 后过期</Text>
          </View>

          <View className="result-more">
            <View className="section-heading">
              <Text className="section-heading__title">换个模板再做一张</Text>
              <Text className="section-heading__action">沿用这次的主体</Text>
            </View>
            <View className="result-template-grid">
              {TEMPLATE_ITEMS.filter((item) => item.id !== work.templateId).slice(0, 4).map((item) => (
                <View
                  className="result-template"
                  key={item.id}
                  onClick={() => void makeAnother(item.id)}
                >
                  <Image src={item.previewImage} mode="aspectFill" />
                  <Text>{item.name}</Text>
                </View>
              ))}
            </View>
            <Text className="result-private-note">原照片和主体临时文件有 24 小时复用期限；后台每小时清理一次，正常情况下删除延迟不到 1 小时。</Text>
          </View>
        </>
      ) : work?.status === 'processing' ? (
        <View className="result-message">
          <Text className="result-message__title">还在制作中</Text>
          <Text className="result-message__copy">{loadError || '作品生成完成后会显示在这里'}</Text>
          <Button className="subtle-button result-message__button" onClick={() => Taro.redirectTo({ url: `/pages/result/index?workId=${encodeURIComponent(work.id)}` })}>刷新作品状态</Button>
        </View>
      ) : work?.status === 'failed' ? (
        <View className="result-message">
          <Text className="result-message__title">这次没有制作成功</Text>
          <Text className="result-message__copy">可以换个模板重新试试，原照片仍在临时保留期内时可复用。</Text>
          <Button className="primary-button result-message__button" onClick={retryFailed}>再试一次</Button>
        </View>
      ) : (
        <View className="result-message">
          <Text className="result-message__title">作品已过期</Text>
          <Text className="result-message__copy">成品保存期已结束。重新制作时，请从相册选择照片。</Text>
          <Button className="primary-button result-message__button" onClick={() => Taro.reLaunch({ url: '/pages/home/index' })}>重新开始</Button>
        </View>
      )}
    </View>
  )
}
