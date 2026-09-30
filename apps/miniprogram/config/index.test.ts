import { afterEach, describe, expect, it, vi } from 'vitest'

const originalTaroEnv = process.env.TARO_ENV
const originalBuildOutputRoot = process.env.TARO_BUILD_OUTPUT_ROOT

afterEach(() => {
  vi.resetModules()
  if (originalTaroEnv === undefined) delete process.env.TARO_ENV
  else process.env.TARO_ENV = originalTaroEnv
  if (originalBuildOutputRoot === undefined) delete process.env.TARO_BUILD_OUTPUT_ROOT
  else process.env.TARO_BUILD_OUTPUT_ROOT = originalBuildOutputRoot
})

describe('Taro build output directory', () => {
  it('keeps H5 output separate from the WeChat DevTools project', async () => {
    process.env.TARO_ENV = 'h5'
    const { default: config } = await import('./index')

    expect((config as unknown as { outputRoot: string }).outputRoot).toBe('dist-h5')
  })

  it('keeps WeChat Mini Program output in dist', async () => {
    process.env.TARO_ENV = 'weapp'
    const { default: config } = await import('./index')

    expect((config as unknown as { outputRoot: string }).outputRoot).toBe('dist')
  })

  it('allows validation builds to write to an isolated output directory', async () => {
    process.env.TARO_ENV = 'weapp'
    process.env.TARO_BUILD_OUTPUT_ROOT = '/tmp/expression-workshop-validation'
    const { default: config } = await import('./index')

    expect((config as unknown as { outputRoot: string }).outputRoot).toBe('/tmp/expression-workshop-validation')
  })
})
