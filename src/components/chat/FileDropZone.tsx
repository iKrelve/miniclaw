/**
 * FileDropZone — Drag-and-drop file upload overlay for the chat area.
 */

import { useState, useCallback, type DragEvent, type ReactNode } from 'react'
import { Upload } from 'lucide-react'

interface FileDropZoneProps {
  children: ReactNode
  onFilesDropped: (files: File[]) => void
  disabled?: boolean
}

export function FileDropZone({ children, onFilesDropped, disabled }: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false)
  let dragCounter = 0

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter++
    if (e.dataTransfer.types.includes('Files')) {
      setDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter--
    if (dragCounter === 0) {
      setDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragging(false)
      dragCounter = 0

      if (disabled) return

      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        onFilesDropped(files)
      }
    },
    [onFilesDropped, disabled],
  )

  return (
    <div
      className="relative flex-1 flex flex-col min-h-0"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {/* Drop overlay */}
      {dragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-blue-500/10 backdrop-blur-sm border-2 border-dashed border-blue-500 rounded-xl m-2">
          <div className="text-center">
            <Upload size={48} className="mx-auto text-blue-500 mb-3" />
            <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">拖放文件到这里</p>
            <p className="text-sm text-zinc-500 mt-1">支持任意文件类型</p>
          </div>
        </div>
      )}
    </div>
  )
}
