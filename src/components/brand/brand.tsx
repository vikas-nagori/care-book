import Image from 'next/image'
import { cn } from '@/lib/utils'

type BrandMarkProps = {
  size?: number
  className?: string
  priority?: boolean
  alt?: string
}

export function BrandMark({
  size = 40,
  className,
  priority = false,
  alt = '',
}: BrandMarkProps) {
  return (
    <Image
      src="/icons/icon.svg"
      width={size}
      height={size}
      alt={alt}
      priority={priority}
      unoptimized
      className={cn('shrink-0', className)}
    />
  )
}

type BrandLockupProps = {
  subtitle?: string
  markSize?: number
  className?: string
  nameClassName?: string
  subtitleClassName?: string
  priority?: boolean
}

export function BrandLockup({
  subtitle,
  markSize = 40,
  className,
  nameClassName,
  subtitleClassName,
  priority = false,
}: BrandLockupProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <BrandMark size={markSize} priority={priority} alt="" />
      <div className="min-w-0">
        <div className={cn('font-semibold leading-tight tracking-tight', nameClassName)}>
          Care-Book
        </div>
        {subtitle ? (
          <div className={cn('mt-0.5 text-sm text-muted-foreground', subtitleClassName)}>
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  )
}
