interface SkeletonProps {
  className?: string
  variant?: 'text' | 'circular' | 'rectangular'
  width?: string | number
  height?: string | number
  count?: number
}

export function Skeleton({ className = '', variant = 'text', width, height, count = 1 }: SkeletonProps) {
  const baseClasses = 'relative overflow-hidden before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/5 before:to-transparent before:bg-[length:200%_100%] before:animate-shimmer'
  const bgStyle = { backgroundColor: 'var(--fill-quaternary)' }

  const variantClasses = {
    text: 'h-4 rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-lg'
  }

  const style: React.CSSProperties = {}
  if (width) style.width = typeof width === 'number' ? `${width}px` : width
  if (height) style.height = typeof height === 'number' ? `${height}px` : height

  const items = Array.from({ length: count }, (_, i) => i)

  return (
    <>
      {items.map(i => (
        <div
          key={i}
          className={`${baseClasses} ${variantClasses[variant]} ${className}`}
          style={{ ...style, ...bgStyle }}
          aria-hidden="true"
        />
      ))}
    </>
  )
}

export function CardSkeleton() {
  return (
    <div className="card p-5 space-y-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" width={40} height={40} />
        <div className="flex-1 space-y-2">
          <Skeleton width="60%" />
          <Skeleton width="35%" />
        </div>
      </div>
      <Skeleton count={3} />
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex gap-4">
        <Skeleton className="flex-1" height={32} />
        <Skeleton className="flex-1" height={32} />
        <Skeleton className="flex-1" height={32} />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="flex-1" />
          <Skeleton className="flex-1" />
          <Skeleton className="flex-[0.5]" />
        </div>
      ))}
    </div>
  )
}
