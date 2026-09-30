export const BACKGROUND_PRESETS = [
  { id: 'template', label: '模板原背景', color: null },
  { id: 'sky-blue', label: '浅蓝', color: '#DCEEFF' },
  { id: 'cream', label: '奶油杏', color: '#FFF0DC' },
  { id: 'lavender', label: '淡紫', color: '#EFEAFF' },
] as const

export type BackgroundPresetId = (typeof BACKGROUND_PRESETS)[number]['id']
