import { describe, expect, it } from 'vitest'

import { createWorkShareMetadata } from './share'
import type { Work } from '../domain/contracts'

describe('work share metadata', () => {
  it('shares only the template name, work ID, and result cover URL', () => {
    const work = {
      id: 'work-12345678',
      templateId: 'pat-head',
      status: 'ready',
      sourceFileId: 'private-source-file',
      sourceUrl: 'https://private.example/original.jpg',
      coverUrl: 'https://temporary.example/cover.jpg',
    } as Work & { sourceFileId: string; sourceUrl: string }

    expect(createWorkShareMetadata(work, '摸头')).toEqual({
      title: '我用「摸头」做了一张表情',
      path: '/pages/result/index?workId=work-12345678',
      imageUrl: 'https://temporary.example/cover.jpg',
    })
  })
})
