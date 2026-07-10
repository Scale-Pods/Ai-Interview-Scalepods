interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
}

const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' }

export function LoadingSpinner({ size = 'md', text }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8">
      <div className={`${sizes[size]} rounded-full animate-spin`} style={{ border: '2px solid var(--fill-tertiary)', borderTopColor: 'var(--blue)' }} />
      {text && <p className="text-sm" style={{ color: 'var(--label-secondary)' }}>{text}</p>}
    </div>
  )
}
