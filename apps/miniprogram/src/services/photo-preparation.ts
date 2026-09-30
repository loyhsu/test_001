import type { SelectedImage } from '../platform/media'
import type { PreparedPhoto } from '../features/editor/creation-store'
import type { PrepareSubjectInput, PreparedSubjectResult, UploadTicket } from './work-api'

export interface PhotoPreparationDependencies {
  createUploadTicket(input: { requestId: string; imageType: SelectedImage['type'] }): Promise<UploadTicket>
  uploadFile(cloudPath: string, localPath: string): Promise<string>
  prepareSubject(input: PrepareSubjectInput): Promise<PreparedSubjectResult>
}

export async function preparePhoto(
  image: SelectedImage,
  requestId: string,
  dependencies: PhotoPreparationDependencies,
): Promise<PreparedPhoto> {
  const uploadTicket = await dependencies.createUploadTicket({
    requestId,
    imageType: image.type,
  })
  const sourceFileId = await dependencies.uploadFile(uploadTicket.cloudPath, image.path)
  if (typeof sourceFileId !== 'string' || !sourceFileId.startsWith('cloud://')) {
    throw new Error('Original photo upload did not return a private file ID')
  }

  const subject = await dependencies.prepareSubject({
    requestId,
    uploadTicketId: uploadTicket.uploadTicketId,
    sourceFileId,
  })
  if (
    typeof subject.subjectUrl !== 'string' || !subject.subjectUrl.startsWith('https://') ||
    !Number.isInteger(subject.width) || subject.width <= 0 ||
    !Number.isInteger(subject.height) || subject.height <= 0 ||
    !Number.isFinite(Date.parse(subject.expiresAt))
  ) {
    throw new Error('Subject preparation returned invalid preview metadata')
  }

  return {
    image,
    requestId,
    uploadTicket,
    sourceFileId,
    subjectUrl: subject.subjectUrl,
    width: subject.width,
    height: subject.height,
    expiresAt: subject.expiresAt,
  }
}
