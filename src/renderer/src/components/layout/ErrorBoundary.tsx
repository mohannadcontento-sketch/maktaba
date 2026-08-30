import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
}

/** حدود خطأ على مستوى الشجرة — أي انهيار رندر يعرض رسالة واضحة بدل شاشة سوداء */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('app crash', error, info.componentStack)
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#0f1115] p-6 text-center text-gray-100">
        <p className="text-lg font-bold text-red-400">تعطّل شيء في التطبيق</p>
        <pre className="max-h-[40vh] max-w-[92vw] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] leading-relaxed text-gray-300">
          {error.message}
          {'\n\n'}
          {error.stack?.slice(0, 1200)}
        </pre>
        <div className="flex gap-2">
          <button
            className="rounded-xl bg-teal-500 px-5 py-2 text-sm font-bold text-teal-950 transition-colors hover:bg-teal-400"
            onClick={() => location.reload()}
          >
            إعادة التشغيل
          </button>
          <button
            className="rounded-xl border border-white/15 px-5 py-2 text-sm text-gray-200 transition-colors hover:bg-white/10"
            onClick={() => this.setState({ error: null })}
          >
            متابعة على أي حال
          </button>
        </div>
      </div>
    )
  }
}
