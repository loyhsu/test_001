import { defineConfig } from '@tarojs/cli'

export default defineConfig({
  projectName: 'expression-workshop',
  date: '2026-09-22',
  designWidth: 750,
  deviceRatio: {
    375: 2,
    750: 1,
  },
  sourceRoot: 'src',
  outputRoot:
    process.env.TARO_BUILD_OUTPUT_ROOT ?? (process.env.TARO_ENV === 'h5' ? 'dist-h5' : 'dist'),
  framework: 'react',
  compiler: 'webpack5',
  defineConstants: {
    'process.env.TARO_APP_CLOUDBASE_ENV_ID': JSON.stringify(
      process.env.TARO_APP_CLOUDBASE_ENV_ID ?? '',
    ),
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
  },
  mini: {},
})
