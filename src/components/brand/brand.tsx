import Image from 'next/image'
import { cn } from '@/lib/utils'

type BrandMarkProps = {
  size?: number
  className?: string
  preload?: boolean
  alt?: string
}

export function BrandMark({
  size = 40,
  className,
  preload = false,
  alt = '',
}: BrandMarkProps) {
  return (
    <Image
      src="/icons/icon.svg"
      width={size}
      height={size}
      alt={alt}
      preload={preload}
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
  preload?: boolean
}

export function BrandLockup({
  subtitle,
  markSize = 40,
  className,
  nameClassName,
  subtitleClassName,
  preload = false,
}: BrandLockupProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <BrandMark size={markSize} preload={preload} alt="" />
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
