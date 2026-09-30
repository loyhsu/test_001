export type EditorBackDestination = 'previous-page' | 'template-detail'

export function getEditorBackDestination(pageStackLength: number): EditorBackDestination {
  return pageStackLength > 1 ? 'previous-page' : 'template-detail'
}
