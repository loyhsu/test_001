import { Button, Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getSafeAreaTopPadding } from '../../platform/safe-area'
import { useEffect } from 'react'

import { setSelectedImage } from '../../features/editor/creation-store'
import { getTemplateDetailPreview, getTemplateInfo } from '../../features/templates/template-data'
import { chooseSourceImage, imageSelectionMessage } from '../../platform/media'
import { track } from '../../services/analytics-runtime'

import './index.scss'

export default function TemplateDetailPage() {
  const params = Taro.getCurrentInstance().router?.params ?? {}
  const template = getTemplateInfo(String(params.templateId ?? 'pat-head'))
  const detailPreview = getTemplateDetailPreview(template.id)

  useEffect(() => {
    void track('template_view', { templateId: template.id })
  }, [template.id])

  const openEditor = async () => {
    void track('photo_select_start', { templateId: template.id })
    try {
      const image = await chooseSourceImage()
      setSelectedImage(image)
      void track('photo_select_success', {
        templateId: template.id,
        sizeKb: Math.round(image.size / 1024),
      })
    } catch (error) {
      const message = imageSelectionMessage(error)
      if (message) Taro.showToast({ title: message, icon: 'none' })
      return
    }
    Taro.navigateTo({ url: `/pages/editor/index?templateId=${template.id}` })
  }

  return (
    <View
      className="screen detail-screen"
      style={{ paddingTop: getSafeAreaTopPadding(Taro.getSystemInfoSync().statusBarHeight) }}
    >
      <View className="page-topbar">
        <Text className="page-topbar__back" onClick={() => Taro.navigateBack()}>返回</Text>
        <Text className="page-topbar__title">模板详情</Text>
        <View className="page-topbar__spacer" />
      </View>

      <View className="detail-hero">
        <Image className="detail-hero__image" src={detailPreview.src} mode={detailPreview.mode} />
        <View className="detail-hero__badge"><Text>效果预览</Text></View>
      </View>

      <View className="detail-title-row">
        <View className="detail-title-copy">
          <Text className="detail-title">{template.name}</Text>
          <Text className="detail-summary">{template.summary}</Text>
        </View>
        <View className="detail-category"><Text>{template.category === 'funny' ? '搞笑' : template.category === 'interaction' ? '互动' : template.category === 'emotion' ? '情绪' : '热门'}</Text></View>
      </View>

      <View className="detail-card">
        <View className="detail-card__heading">
          <View className="detail-card__dot" />
          <Text>制作小贴士</Text>
        </View>
        <Text className="detail-card__copy">{template.photoTip}</Text>
      </View>

      <View className="detail-card detail-card--blue">
        <Text className="detail-blue-title">一张照片，变成专属表情</Text>
        <Text className="detail-blue-copy">下一步可以调整主体位置和动图速度</Text>
      </View>

      <View className="detail-action">
        <Button className="primary-button" onClick={openEditor}>用这款模板制作</Button>
        <Text className="detail-action__note">{detailPreview.note}</Text>
      </View>
    </View>
  )
}
