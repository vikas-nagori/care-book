'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Plus, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface SearchableSelectOption {
  value: string
  label: string
  /** Optional muted text shown after the label (e.g. a role or phone). */
  hint?: string
}

interface SearchableSelectProps {
  options: SearchableSelectOption[]
  value: string | null
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  id?: string
  className?: string
  /** Extra classes for the trigger button (e.g. taller mobile-friendly fields). */
  triggerClassName?: string
  /** When true, typing a name with no exact match offers a "create" option. */
  allowCreate?: boolean
  onCreate?: (query: string) => void
  createLabel?: (query: string) => string
}

/**
 * Click-to-open dropdown with an internal type-to-search filter. Search-only by
 * default (options are provided); pass `allowCreate` + `onCreate` to let the
 * user add a brand-new entry from the typed query (e.g. a referring doctor).
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results found.',
  disabled = false,
  id,
  className,
  triggerClassName,
  allowCreate = false,
  onCreate,
  createLabel = (q) => `Add “${q}”`,
}: SearchableSelectProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selectedOption = options.find((o) => o.value === value) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  const exactMatch = useMemo(
    () => options.some((o) => o.label.trim().toLowerCase() === query.trim().toLowerCase()),
    [options, query],
  )
  const canCreate = allowCreate && query.trim().length > 0 && !exactMatch

  // Close on outside click while open.
  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  // Reset the query and focus the search field each time the panel opens.
  useEffect(() => {
    if (!open) return
    setQuery('')
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [open])

  function handleSelect(optionValue: string) {
    onChange(optionValue)
    setOpen(false)
  }

  function handleCreate() {
    onCreate?.(query.trim())
    setOpen(false)
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          triggerClassName,
        )}
      >
        <span className={cn('truncate', !selectedOption && 'text-muted-foreground')}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full rounded-md border bg-background shadow-lg">
          <div className="relative border-b p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8"
              autoComplete="off"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted',
                  value === option.value && 'bg-muted',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(option.value)}
              >
                <span className="truncate">
                  {option.label}
                  {option.hint && <span className="ml-1 text-xs text-muted-foreground">{option.hint}</span>}
                </span>
                {value === option.value && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            ))}

            {canCreate && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCreate}
              >
                <Plus className="h-4 w-4" />
                {createLabel(query.trim())}
              </button>
            )}

            {filtered.length === 0 && !canCreate && (
              <p className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
