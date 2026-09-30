import type { Work } from '../domain/contracts'

export interface WorkShareMetadata {
  title: string
  path: string
  imageUrl?: string
}

export function createWorkShareMetadata(
  work: Pick<Work, 'id' | 'coverUrl'>,
  templateName: string,
): WorkShareMetadata {
  const metadata: WorkShareMetadata = {
    title: `我用「${templateName}」做了一张表情`,
    path: `/pages/result/index?workId=${encodeURIComponent(work.id)}`,
  }
  if (work.coverUrl) metadata.imageUrl = work.coverUrl
  return metadata
}
