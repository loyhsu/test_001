import { Component, type PropsWithChildren } from 'react'
import Taro from '@tarojs/taro'

import { flushAnalytics } from './services/analytics-runtime'

import './app.scss'

const cloudEnvironmentId = process.env.TARO_APP_CLOUDBASE_ENV_ID
if (cloudEnvironmentId && Taro.cloud) {
  Taro.cloud.init({ env: cloudEnvironmentId })
}

export default class App extends Component<PropsWithChildren> {
  componentDidHide(): void {
    void flushAnalytics()
  }

  render() {
    return this.props.children
  }
}
