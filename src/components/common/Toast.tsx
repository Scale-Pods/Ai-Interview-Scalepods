import { Toaster } from 'react-hot-toast'

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: 'var(--glass-fill)',
          color: 'var(--label-primary)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          borderRadius: '10px',
          fontSize: '14px',
          outline: '1px solid var(--glass-border)',
          outlineOffset: '-1px',
          boxShadow: 'var(--glass-shadow)'
        },
        success: { iconTheme: { primary: 'var(--green)', secondary: 'transparent' } },
        error: { iconTheme: { primary: 'var(--red)', secondary: 'transparent' } }
      }}
    />
  )
}
