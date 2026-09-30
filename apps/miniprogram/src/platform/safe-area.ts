export function getSafeAreaTopPadding(
  statusBarHeight?: number,
  menuButtonBottom?: number,
): string {
  const statusBarPadding = statusBarHeight !== undefined && statusBarHeight > 0
    ? statusBarHeight + 8
    : 0
  const menuButtonPadding = menuButtonBottom !== undefined && menuButtonBottom > 0
    ? menuButtonBottom + 8
    : 0

  if (statusBarPadding || menuButtonPadding) {
    return `${Math.max(statusBarPadding, menuButtonPadding)}px`
  }

  return 'calc(env(safe-area-inset-top) + 52px)'
}
