/**
 * FileAttachmentDisplay — renders file attachments with image thumbnails,
 * lightbox preview, and file cards for non-image files.
 */

import { useState, useCallback } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { File as FileIcon } from '@phosphor-icons/react'
import { Button } from '../ui/button'

// ── Types ──────────────────────────────────────────────────────────────

interface FileAttachment {
  id?: string
  name: string
  type?: string
  size?: number
  data?: string
  filePath?: string
}

function isImageFile(type?: string): boolean {
  if (!type) return false
  return type.startsWith('image/')
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileUrl(f: FileAttachment): string {
  if (f.data) return `data:${f.type || 'application/octet-stream'};base64,${f.data}`
  return ''
}

// ── ImageThumbnail ─────────────────────────────────────────────────────

function ImageThumbnail({ src, alt, onClick }: { src: string; alt: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg overflow-hidden cursor-pointer hover:opacity-80 p-0 h-auto transition-opacity"
    >
      <img src={src} alt={alt} className="max-h-32 w-full object-cover rounded-lg" />
    </button>
  )
}

// ── FileCard ───────────────────────────────────────────────────────────

function FileCard({ name, size }: { name: string; size?: number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/50 p-3 flex items-center gap-3">
      <FileIcon size={20} className="text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{name}</div>
        {size != null && (
          <div className="text-xs text-muted-foreground">{formatFileSize(size)}</div>
        )}
      </div>
    </div>
  )
}

// ── ImageLightbox ──────────────────────────────────────────────────────

function ImageLightbox({
  images,
  initialIndex,
  open,
  onClose,
}: {
  images: Array<{ src: string; alt: string }>
  initialIndex: number
  open: boolean
  onClose: () => void
}) {
  const [idx, setIdx] = useState(initialIndex)

  const goToPrev = useCallback(() => {
    setIdx((prev) => (prev > 0 ? prev - 1 : images.length - 1))
  }, [images.length])

  const goToNext = useCallback(() => {
    setIdx((prev) => (prev < images.length - 1 ? prev + 1 : 0))
  }, [images.length])

  if (!open || images.length === 0) return null
  const current = images[idx]

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <img
          src={current.src}
          alt={current.alt}
          className="max-w-[90vw] max-h-[90vh] object-contain"
        />

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition"
        >
          <X size={20} />
        </button>

        {images.length > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={goToPrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
            >
              <ArrowLeft size={24} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={goToNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
            >
              <ArrowRight size={24} />
            </Button>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-white/70 text-sm">
              {idx + 1} / {images.length}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────

interface FileAttachmentDisplayProps {
  files: FileAttachment[]
}

export function FileAttachmentDisplay({ files }: FileAttachmentDisplayProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const imageFiles = files.filter((f) => isImageFile(f.type) && fileUrl(f))
  const otherFiles = files.filter((f) => !isImageFile(f.type) || !fileUrl(f))

  const lightboxImages = imageFiles.map((f) => ({
    src: fileUrl(f),
    alt: f.name,
  }))

  const handlePreview = useCallback((index: number) => {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }, [])

  if (files.length === 0) return null

  const gridCols =
    imageFiles.length === 1
      ? 'grid-cols-1 max-w-xs'
      : imageFiles.length === 2
        ? 'grid-cols-2 max-w-sm'
        : 'grid-cols-3 max-w-md'

  return (
    <div className="space-y-2 mb-2">
      {imageFiles.length > 0 && (
        <div className={`grid gap-2 ${gridCols}`}>
          {imageFiles.map((file, i) => (
            <ImageThumbnail
              key={file.id || `img-${i}`}
              src={fileUrl(file)}
              alt={file.name}
              onClick={() => handlePreview(i)}
            />
          ))}
        </div>
      )}

      {otherFiles.length > 0 && (
        <div className="space-y-1.5">
          {otherFiles.map((file, i) => (
            <FileCard key={file.id || `file-${i}`} name={file.name} size={file.size} />
          ))}
        </div>
      )}

      <ImageLightbox
        images={lightboxImages}
        initialIndex={lightboxIndex}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  )
}
