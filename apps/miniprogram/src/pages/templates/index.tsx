import { ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getSafeAreaTopPadding } from '../../platform/safe-area'
import { useMemo, useState } from 'react'

import { TemplateCard } from '../../components/template-card'
import {
  FEATURED_TEMPLATES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_ITEMS,
  type TemplateCategory,
} from '../../features/templates/template-data'

import './index.scss'

type CategoryId = TemplateCategory | 'popular' | 'all'

export default function TemplatesPage() {
  const [activeCategory, setActiveCategory] = useState<CategoryId>('all')
  const templates = useMemo(() => {
    if (activeCategory === 'all') return TEMPLATE_ITEMS
    if (activeCategory === 'popular') return FEATURED_TEMPLATES
    return TEMPLATE_ITEMS.filter((item) => item.category === activeCategory)
  }, [activeCategory])

  const openTemplate = (templateId: string) => {
    Taro.navigateTo({ url: `/pages/template-detail/index?templateId=${templateId}` })
  }

  return (
    <View
      className="screen templates-screen"
      style={{ paddingTop: getSafeAreaTopPadding(Taro.getSystemInfoSync().statusBarHeight) }}
    >
      <View className="page-topbar">
        <Text className="page-topbar__back" onClick={() => Taro.navigateBack()}>返回</Text>
        <Text className="page-topbar__title">模板库</Text>
        <View className="page-topbar__spacer" />
      </View>

      <View className="page-heading templates-heading">
        <Text className="page-heading__title">挑一个喜欢的表情</Text>
        <Text className="page-heading__copy">选好模板后，再放入照片预览制作效果</Text>
      </View>

      <ScrollView className="category-scroll" scrollX showScrollbar={false}>
        <View className="category-list">
          {TEMPLATE_CATEGORIES.map((category) => (
            <View
              key={category.id}
              className={`category-chip ${activeCategory === category.id ? 'category-chip--active' : ''}`}
              onClick={() => setActiveCategory(category.id)}
            >
              <Text>{category.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View className="templates-meta">
        <Text className="templates-meta__title">
          {TEMPLATE_CATEGORIES.find((category) => category.id === activeCategory)?.label}模板
        </Text>
        <Text className="templates-meta__count">{templates.length} 款</Text>
      </View>

      <View className="templates-grid">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onSelect={() => openTemplate(template.id)}
          />
        ))}
      </View>

      {templates.length === 0 && (
        <View className="templates-empty">
          <Text>这个分类还在准备中</Text>
        </View>
      )}

      <Text className="templates-footnote">更多表情模板，后续慢慢上新</Text>
    </View>
  )
}
