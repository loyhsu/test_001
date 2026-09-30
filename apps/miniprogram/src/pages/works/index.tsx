import { Button, Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getSafeAreaTopPadding } from '../../platform/safe-area'
import { useEffect, useState } from 'react'

import type { Work } from '../../domain/contracts'
import { setPendingGeneration } from '../../features/editor/creation-store'
import { getTemplateInfo, getTemplatePhoto } from '../../features/templates/template-data'
import { createRequestId } from '../../platform/request-id'
import { WorkApiError, workApi } from '../../services/work-api'
import { track } from '../../services/analytics-runtime'

import './index.scss'

function statusLabel(work: Work): string {
  if (work.status === 'processing') return '制作中'
  if (work.status === 'failed') return '未成功'
  if (work.status === 'expired') return '已过期'
  return '已完成'
}

export default function WorksPage() {
  const [works, setWorks] = useState<Work[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyWorkId, setBusyWorkId] = useState('')

  const loadWorks = async () => {
    setLoading(true)
    setError('')
    try {
      setWorks(await workApi.listWorks())
    } catch (caught) {
      const code = caught instanceof WorkApiError ? caught.code : ''
      setError(code === 'UNAUTHENTICATED'
        ? '请先进入小程序后再查看作品'
        : '暂时无法读取作品，请检查云环境配置和网络后重试')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadWorks()
  }, [])

  const openWork = (work: Work) => {
    if (work.status === 'expired') {
      void Taro.showModal({
        title: '作品已过期',
        content: '成品保存期已结束。重新制作时，请从相册选择照片。',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    Taro.navigateTo({ url: `/pages/result/index?workId=${encodeURIComponent(work.id)}` })
  }

  const retryWork = async (event: { stopPropagation: () => void }, work: Work) => {
    event.stopPropagation()
    if (busyWorkId) return
    setBusyWorkId(work.id)
    try {
      const requestId = await createRequestId()
      setPendingGeneration({
        requestId,
        templateId: work.templateId,
        editorState: work.editorState,
        sourceWorkId: work.id,
      })
      void track('create_again_tap', {
        workId: work.id,
        nextTemplateId: work.templateId,
      })
      await Taro.navigateTo({ url: '/pages/processing/index' })
      setBusyWorkId('')
    } catch {
      setBusyWorkId('')
      Taro.showToast({ title: '暂时无法开始，请稍后重试', icon: 'none' })
    }
  }

  const deleteWork = async (event: { stopPropagation: () => void }, work: Work) => {
    event.stopPropagation()
    const confirmation = await Taro.showModal({
      title: '删除这份作品？',
      content: '删除后无法恢复，生成的成品文件也会一并删除。',
      confirmText: '删除',
      confirmColor: '#d64b45',
      cancelText: '取消',
    })
    if (!confirmation.confirm) return
    setBusyWorkId(work.id)
    try {
      await workApi.deleteWork(work.id)
      setWorks((current) => current.filter((item) => item.id !== work.id))
      Taro.showToast({ title: '作品已删除', icon: 'success' })
    } catch {
      Taro.showToast({ title: '删除失败，请稍后重试', icon: 'none' })
    } finally {
      setBusyWorkId('')
    }
  }

  return (
    <View
      className="screen works-screen"
      style={{ paddingTop: getSafeAreaTopPadding(Taro.getSystemInfoSync().statusBarHeight) }}
    >
      <View className="page-topbar">
        <Text className="page-topbar__back" onClick={() => Taro.navigateBack()}>返回</Text>
        <Text className="page-topbar__title">我的作品</Text>
        <Text className="works-refresh" onClick={() => void loadWorks()}>刷新</Text>
      </View>

      <View className="page-heading works-heading">
        <Text className="page-heading__title">作品记录</Text>
        <Text className="page-heading__copy">成品自生成起保留 30 天，原照片和处理中间文件最长保留约 24 小时</Text>
      </View>

      {loading ? (
        <View className="works-message"><Text>正在读取作品…</Text></View>
      ) : error ? (
        <View className="works-message">
          <Text>{error}</Text>
          <Button className="subtle-button works-retry" onClick={() => void loadWorks()}>重新加载</Button>
        </View>
      ) : works.length === 0 ? (
        <View className="works-empty">
          <Image src={getTemplatePhoto('pat-head')} mode="aspectFill" />
          <Text className="works-empty__title">这里还没有作品</Text>
          <Text className="works-empty__copy">选一张照片和喜欢的模板，开始制作吧</Text>
          <Button className="primary-button works-empty__button" onClick={() => Taro.reLaunch({ url: '/pages/home/index' })}>去挑模板</Button>
        </View>
      ) : (
        <View className="works-list">
          {works.map((work) => {
            const template = getTemplateInfo(work.templateId)
            const cover = work.coverUrl ?? template.previewImage
            const isBusy = busyWorkId === work.id
            return (
              <View className="work-row" key={work.id} onClick={() => openWork(work)}>
                <Image className="work-row__cover" src={cover} mode="aspectFill" />
                <View className="work-row__body">
                  <View className="work-row__title-line">
                    <Text className="work-row__title">{template.name}</Text>
                    <Text className={`work-status work-status--${work.status}`}>{statusLabel(work)}</Text>
                  </View>
                  <Text className="work-row__date">{new Date(work.createdAt).toLocaleDateString()}</Text>
                  <View className="work-row__actions">
                    {work.status === 'failed' && (
                      <Text
                        className="work-row__action work-row__action--primary"
                        onClick={(event) => void retryWork(event, work)}
                      >{isBusy ? '准备中…' : '再试一次'}</Text>
                    )}
                    <Text
                      className="work-row__action work-row__action--delete"
                      onClick={(event) => void deleteWork(event, work)}
                    >删除</Text>
                  </View>
                </View>
                <Text className="work-row__chevron">›</Text>
              </View>
            )
          })}
        </View>
      )}
    </View>
  )
}
