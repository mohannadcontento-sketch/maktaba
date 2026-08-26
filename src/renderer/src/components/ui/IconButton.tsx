import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { className, active, title, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      title={title}
      className={cn(
        'no-drag inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors select-none',
        'hover:bg-black/[0.06] active:scale-95 disabled:opacity-40 disabled:pointer-events-none',
        'dark:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-accent',
        active && 'bg-accent/12 text-accent-strong dark:bg-daccent/20 dark:text-daccent',
        className
      )}
      {...rest}
    />
  )
})
