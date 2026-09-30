import type { SelectedImage } from '../../platform/media'
import type { EditorState } from '../../domain/contracts'
import type { UploadTicket } from '../../services/work-api'

export interface PreparedPhoto {
  image: SelectedImage
  requestId: string
  uploadTicket: UploadTicket
  sourceFileId: string
  subjectUrl: string
  width: number
  height: number
  expiresAt: string
}

export interface PendingGeneration {
  requestId: string
  templateId: string
  editorState: EditorState
  sourceImage?: SelectedImage
  sourceWorkId?: string
  sourceFileId?: string
  uploadTicket?: { uploadTicketId: string; cloudPath: string; expiresAt: string }
}

let selectedImage: SelectedImage | undefined
let preparedPhoto: PreparedPhoto | undefined
let pendingGeneration: PendingGeneration | undefined

export function setSelectedImage(image: SelectedImage): void {
  selectedImage = image
  preparedPhoto = undefined
}

export function getSelectedImage(): SelectedImage | undefined {
  return selectedImage
}

export function setPreparedPhoto(photo: PreparedPhoto): void {
  if (selectedImage?.path !== photo.image.path) return
  preparedPhoto = photo
}

export function getPreparedPhoto(): PreparedPhoto | undefined {
  return preparedPhoto
}

export function clearPreparedPhoto(): void {
  preparedPhoto = undefined
}

export function setPendingGeneration(generation: PendingGeneration): void {
  pendingGeneration = generation
}

export function getPendingGeneration(): PendingGeneration | undefined {
  return pendingGeneration
}

export function updatePendingGeneration(
  patch: Partial<PendingGeneration>,
): PendingGeneration | undefined {
  if (!pendingGeneration) return undefined
  pendingGeneration = { ...pendingGeneration, ...patch }
  return pendingGeneration
}

export function clearPendingGeneration(): void {
  pendingGeneration = undefined
}
