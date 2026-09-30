import { Image, Text, View } from '@tarojs/components'

import type { TemplateDisplay } from '../../features/templates/template-data'

import './index.scss'

interface TemplateCardProps {
  template: TemplateDisplay
  variant?: 'compact' | 'full'
  onSelect: () => void
}

export function TemplateCard({ template, variant = 'full', onSelect }: TemplateCardProps) {
  return (
    <View className={`template-card template-card--${variant}`} onClick={onSelect}>
      <Image
        className="template-card__image"
        src={template.previewImage}
        mode="aspectFill"
        lazyLoad
      />
      <View className="template-card__caption">
        <Text className="template-card__name">{template.name}</Text>
        {variant === 'full' && <Text className="template-card__summary">{template.summary}</Text>}
      </View>
    </View>
  )
}
