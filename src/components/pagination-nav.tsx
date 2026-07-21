'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getPaginationItems } from '@/lib/pagination'

type BaseProps = {
  page: number
  totalPages: number
  ariaLabel?: string
}

// Two drive modes: link mode (`basePath`) for server-rendered pages that navigate via `?page=`,
// and callback mode (`onPageChange`) for client components that paginate in place. A server
// component can only pass the serializable `basePath` variant — never a function.
type LinkProps = BaseProps & { basePath: string; pageParam?: string; onPageChange?: never }
type CallbackProps = BaseProps & { onPageChange: (page: number) => void; basePath?: never; pageParam?: never }

export function PaginationNav(props: LinkProps | CallbackProps) {
  const { page, totalPages, ariaLabel = 'Pages' } = props
  if (totalPages <= 1) return null

  const items = getPaginationItems(page, totalPages)
  const isLinkMode = 'basePath' in props && props.basePath !== undefined
  const hrefFor = (target: number) =>
    isLinkMode ? `${(props as LinkProps).basePath}?${(props as LinkProps).pageParam ?? 'page'}=${target}` : '#'

  function control(
    key: string,
    target: number,
    disabled: boolean,
    children: React.ReactNode,
    opts: { active?: boolean } = {},
  ) {
    const variant = opts.active ? 'default' : 'outline'
    const className = typeof children === 'number' ? 'min-w-10' : undefined
    if (disabled) {
      return <Button key={key} variant="outline" size="sm" className={className} disabled>{children}</Button>
    }
    if (isLinkMode) {
      return (
        <Button key={key} variant={variant} size="sm" className={className} asChild>
          <Link href={hrefFor(target)} aria-current={opts.active ? 'page' : undefined}>{children}</Link>
        </Button>
      )
    }
    return (
      <Button
        key={key}
        variant={variant}
        size="sm"
        className={className}
        aria-current={opts.active ? 'page' : undefined}
        onClick={() => (props as CallbackProps).onPageChange(target)}
      >
        {children}
      </Button>
    )
  }

  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap items-center justify-center gap-1 pt-3">
      {control('prev', page - 1, page <= 1, 'Previous')}
      {items.map((item, index) =>
        item === 'ellipsis' ? (
          <span key={`ellipsis-${index}`} className="px-2 text-sm text-muted-foreground">…</span>
        ) : (
          control(`p-${item}`, item, false, item, { active: item === page })
        ),
      )}
      {control('next', page + 1, page >= totalPages, 'Next')}
    </nav>
  )
}
