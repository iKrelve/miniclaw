/**
 * FileTree — interactive file tree display with expand/collapse.
 * Adapted from CodePilot's ai-elements/file-tree.tsx.
 */

import type { HTMLAttributes, ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { Folder, FolderOpen, File, CaretRight, Plus } from '@phosphor-icons/react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

interface FileTreeContextType {
  expandedPaths: Set<string>
  togglePath: (path: string) => void
  selectedPath?: string
  onSelect?: (path: string) => void
  onAdd?: (path: string) => void
}

const noop = () => {}

const FileTreeContext = createContext<FileTreeContextType>({
  expandedPaths: new Set(),
  togglePath: noop,
})

export type FileTreeProps = HTMLAttributes<HTMLDivElement> & {
  expanded?: Set<string>
  defaultExpanded?: Set<string>
  selectedPath?: string
  onSelect?: (path: string) => void
  onAdd?: (path: string) => void
  onExpandedChange?: (expanded: Set<string>) => void
}

export const FileTree = ({
  expanded: controlledExpanded,
  defaultExpanded = new Set(),
  selectedPath,
  onSelect,
  onAdd,
  onExpandedChange,
  className,
  children,
  ...props
}: FileTreeProps) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)
  const expandedPaths = controlledExpanded ?? internalExpanded

  const togglePath = useCallback(
    (path: string) => {
      const newExpanded = new Set(expandedPaths)
      if (newExpanded.has(path)) {
        newExpanded.delete(path)
      } else {
        newExpanded.add(path)
      }
      setInternalExpanded(newExpanded)
      onExpandedChange?.(newExpanded)
    },
    [expandedPaths, onExpandedChange],
  )

  const contextValue = useMemo(
    () => ({ expandedPaths, onAdd, onSelect, selectedPath, togglePath }),
    [expandedPaths, onAdd, onSelect, selectedPath, togglePath],
  )

  return (
    <FileTreeContext.Provider value={contextValue}>
      <div
        className={cn('rounded-lg border bg-background font-mono text-sm', className)}
        role="tree"
        {...props}
      >
        <div className="p-2">{children}</div>
      </div>
    </FileTreeContext.Provider>
  )
}

export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & {
  path: string
  name: string
}

export const FileTreeFolder = ({
  path,
  name,
  className,
  children,
  ...props
}: FileTreeFolderProps) => {
  const { expandedPaths, togglePath } = useContext(FileTreeContext)
  const isExpanded = expandedPaths.has(path)

  const handleToggle = useCallback(() => {
    togglePath(path)
  }, [togglePath, path])

  return (
    <Collapsible onOpenChange={handleToggle} open={isExpanded}>
      <div className={cn('', className)} role="treeitem" tabIndex={0} {...props}>
        <div className="flex w-full items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 hover:bg-muted"
              onClick={(e) => e.stopPropagation()}
            >
              <CaretRight
                size={16}
                className={cn(
                  'text-muted-foreground transition-transform',
                  isExpanded && 'rotate-90',
                )}
              />
            </button>
          </CollapsibleTrigger>
          <span className="shrink-0">
            {isExpanded ? (
              <FolderOpen size={16} className="text-muted-foreground" />
            ) : (
              <Folder size={16} className="text-muted-foreground" />
            )}
          </span>
          <span className="truncate">{name}</span>
        </div>
        <CollapsibleContent>
          <div className="ml-4 border-l pl-2">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & {
  path: string
  name: string
  icon?: ReactNode
}

export const FileTreeFile = ({
  path,
  name,
  icon,
  className,
  children,
  ...props
}: FileTreeFileProps) => {
  const { selectedPath, onSelect, onAdd } = useContext(FileTreeContext)
  const isSelected = selectedPath === path

  const handleClick = useCallback(() => {
    onSelect?.(path)
  }, [onSelect, path])

  const handleAdd = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onAdd?.(path)
    },
    [onAdd, path],
  )

  return (
    <div
      className={cn(
        'group/file flex cursor-pointer items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-muted/50',
        isSelected && 'bg-muted',
        className,
      )}
      onClick={handleClick}
      role="treeitem"
      tabIndex={0}
      {...props}
    >
      {children ?? (
        <>
          <span className="shrink-0">
            {icon ?? <File size={16} className="text-muted-foreground" />}
          </span>
          <span className="truncate">{name}</span>
          {onAdd && (
            <button
              type="button"
              className="ml-auto flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover/file:opacity-100"
              onClick={handleAdd}
              title="Add to chat"
            >
              <Plus size={12} className="text-muted-foreground" />
            </button>
          )}
        </>
      )}
    </div>
  )
}
