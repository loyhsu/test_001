import { describe, expect, it } from 'vitest'

import { getSafeAreaTopPadding } from './safe-area'

describe('getSafeAreaTopPadding', () => {
  it('places custom content below the native status bar', () => {
    expect(getSafeAreaTopPadding(59)).toBe('67px')
  })

  it('keeps the home content below the native menu capsule', () => {
    expect(getSafeAreaTopPadding(59, 110)).toBe('118px')
  })

  it('never lets the menu-capsule inset reduce the status-bar inset', () => {
    expect(getSafeAreaTopPadding(59, 50)).toBe('67px')
  })

  it('provides extra room when a web preview has no native status bar metric', () => {
    expect(getSafeAreaTopPadding(undefined)).toBe('calc(env(safe-area-inset-top) + 52px)')
    expect(getSafeAreaTopPadding(0)).toBe('calc(env(safe-area-inset-top) + 52px)')
  })
})
