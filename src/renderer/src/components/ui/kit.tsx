import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

// ---------- زر ----------
type BtnVariant = 'primary' | 'ghost' | 'outline' | 'danger' | 'soft'
type BtnSize = 'sm' | 'md' | 'lg' | 'icon'

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  size?: BtnSize
}

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { className, variant = 'primary', size = 'md', ...rest },
  ref
) {
  const variants: Record<BtnVariant, string> = {
    primary:
      'bg-accent text-white hover:bg-accent-strong dark:bg-daccent dark:text-dapp dark:hover:brightness-110 shadow-sm',
    ghost: 'hover:bg-black/5 dark:hover:bg-white/10 text-current',
    outline:
      'border border-line dark:border-dline bg-surface dark:bg-dsurface hover:bg-surface2 dark:hover:bg-dsurface2',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    soft: 'bg-teal-600/10 text-accent-strong dark:bg-daccent/15 dark:text-daccent hover:bg-teal-600/20'
  }
  const sizes: Record<BtnSize, string> = {
    sm: 'h-8 px-3 text-[13px] gap-1.5',
    md: 'h-9 px-4 text-sm gap-2',
    lg: 'h-11 px-6 text-base gap-2',
    icon: 'h-9 w-9 p-0'
  }
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:opacity-45 disabled:pointer-events-none active:scale-[0.98]',
        variants[variant],
        sizes[size],
        className
      )}
      {...rest}
    />
  )
})

// ---------- حقول ----------
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-line dark:border-dline bg-surface dark:bg-dsurface2 px-3 text-sm',
        'placeholder:text-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20',
        className
      )}
      {...rest}
    />
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full rounded-lg border border-line dark:border-dline bg-surface dark:bg-dsurface2 p-3 text-sm leading-relaxed',
          'placeholder:text-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-y min-h-[80px]',
          className
        )}
        {...rest}
      />
    )
  }
)

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 rounded-lg border border-line dark:border-dline bg-surface dark:bg-dsurface2 px-3 text-sm cursor-pointer',
        'focus:outline-none focus:border-accent',
        className
      )}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange(v: boolean): void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? 'bg-accent dark:bg-daccent' : 'bg-gray-300 dark:bg-dline'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all rtl:right-0.5 ltr:left-0.5',
          checked && 'rtl:!right-[22px] ltr:!left-[22px]'
        )}
      />
    </button>
  )
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
  ...rest
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange(v: number): void
  className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'min' | 'max' | 'step' | 'onChange'>) {
  return (
    <input
      type="range"
      dir="ltr"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn('h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-300 dark:bg-dline accent-accent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:dark:bg-daccent [&::-webkit-slider-thumb]:shadow', className)}
      {...rest}
    />
  )
}

// ---------- شارات وعناصر ----------
export function Badge({
  children,
  color = '#0d9488',
  soft = true
}: {
  children: ReactNode
  color?: string
  soft?: boolean
}) {
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-tight"
      style={
        soft
          ? { backgroundColor: `${color}22`, color }
          : { backgroundColor: color, color: '#fff' }
      }
    >
      {children}
    </span>
  )
}

export function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10', className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-400 transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  )
}

export function Spinner({ size = 24 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  )
}

export function EmptyState({
  icon,
  title,
  hint,
  action
}: {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center anim-in">
      {icon && <div className="text-muted/60">{icon}</div>}
      <div>
        <p className="text-lg font-semibold">{title}</p>
        {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

export function StarRating({
  value,
  onChange,
  size = 16
}: {
  value: number
  onChange?(v: number): void
  size?: number
}) {
  return (
    <span className="inline-flex items-center gap-0.5" dir="ltr">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={i <= value ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
          className={cn(i <= value ? 'text-amber-400' : 'text-gray-300 dark:text-dline', onChange && 'cursor-pointer')}
          onClick={() => onChange?.(i === value ? 0 : i)}
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  )
}
