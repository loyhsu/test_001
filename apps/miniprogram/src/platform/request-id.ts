import Taro from '@tarojs/taro'

import { requestIdFromRandomValues } from '../features/generation/generation-state'

export async function createRequestId(): Promise<string> {
  const result = await Taro.getRandomValues({ length: 16 })
  return requestIdFromRandomValues(new Uint8Array(result.randomValues))
}
