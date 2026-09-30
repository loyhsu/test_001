import { Button, Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getSafeAreaTopPadding } from '../../platform/safe-area'
import { useEffect } from 'react'

import { TemplateCard } from '../../components/template-card'
import {
  FEATURED_TEMPLATES,
  getTemplateInfo,
  getTemplatePhoto,
} from '../../features/templates/template-data'
import { setSelectedImage } from '../../features/editor/creation-store'
import { chooseSourceImage, imageSelectionMessage } from '../../platform/media'
import { track } from '../../services/analytics-runtime'

import './index.scss'

const defaultTemplate = getTemplateInfo('pat-head')

declare const wx: {
  getMenuButtonBoundingClientRect?: () => { bottom?: number }
} | undefined

function getHomeTopPadding(): string {
  let menuButtonBottom: number | undefined
  try {
    if (typeof wx !== 'undefined') {
      menuButtonBottom = wx.getMenuButtonBoundingClientRect?.().bottom
    }
  } catch {
    // The H5 preview does not provide the native WeChat menu-button API.
  }

  return getSafeAreaTopPadding(Taro.getSystemInfoSync().statusBarHeight, menuButtonBottom)
}

export default function HomePage() {
  useEffect(() => {
    void track('home_view')
  }, [])

  const openEditor = async () => {
    void track('photo_select_start', { templateId: 'pat-head' })
    try {
      const image = await chooseSourceImage()
      setSelectedImage(image)
      void track('photo_select_success', {
        templateId: 'pat-head',
        sizeKb: Math.round(image.size / 1024),
      })
    } catch (error) {
      const message = imageSelectionMessage(error)
      if (message) Taro.showToast({ title: message, icon: 'none' })
      return
    }
    Taro.navigateTo({ url: '/pages/editor/index?templateId=pat-head' })
  }

  const openLibrary = () => {
    Taro.navigateTo({ url: '/pages/templates/index' })
  }

  const openWorks = () => {
    Taro.navigateTo({ url: '/pages/works/index' })
  }

  const openTemplate = (templateId: string) => {
    Taro.navigateTo({ url: `/pages/template-detail/index?templateId=${templateId}` })
  }

  return (
    <View
      className="screen home-screen"
      style={{ paddingTop: getHomeTopPadding() }}
    >
      <View className="home-brand">
        <Image className="home-brand__mark" src={getTemplatePhoto('pat-head')} mode="aspectFill" />
        <View className="home-brand__copy">
          <Text className="home-brand__name">表情工坊</Text>
          <Text className="home-brand__tagline">把心情做成一张动图</Text>
        </View>
        <View className="home-brand__badge" onClick={openWorks}>
          <Text>我的作品</Text>
        </View>
      </View>

      <View className="home-intro">
        <Text className="home-intro__title">照片，变成会动的表情</Text>
        <Text className="home-intro__copy">挑一张照片，做成聊天里的小表情</Text>
      </View>

      <View className="home-stage">
        <View className="home-stage__label">
          <Text>照片预览</Text>
        </View>
        <Image
          className="home-stage__photo"
          src={getTemplatePhoto('pat-head')}
          mode="aspectFill"
        />
        <View className="home-stage__bubble">
          <Text>今天想用哪种心情？</Text>
        </View>
        <View className="home-stage__result">
          <Image
            className="home-stage__result-image"
            src={FEATURED_TEMPLATES[1].previewImage}
            mode="aspectFill"
          />
          <View className="home-stage__result-copy">
            <Text className="home-stage__result-title">摇头</Text>
            <Text className="home-stage__result-caption">表情预览</Text>
          </View>
        </View>
      </View>

      <Button className="primary-button home-primary" onClick={openEditor}>
        上传照片开始制作
      </Button>
      <Text className="home-support">人物和宠物都适用 · 共 6 款模板</Text>

      <View className="section-heading home-section-heading">
        <Text className="section-heading__title">热门模板</Text>
        <Text className="section-heading__action" onClick={openLibrary}>
          全部 6 个
        </Text>
      </View>
      <View className="home-template-row">
        {FEATURED_TEMPLATES.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            variant="compact"
            onSelect={() => openTemplate(template.id)}
          />
        ))}
      </View>
    </View>
  )
}
