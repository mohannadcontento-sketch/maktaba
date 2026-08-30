/**
 * Polyfills للأجهزة القديمة — خاصة Android System WebView
 * تُستورد أولًا في main.tsx قبل أي شيء آخر.
 * كل ترقيع محمي: لا شيء يكسر بيئات حديثة (التحقق من الوجود أولًا)
 */

/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-explicit-any */

const g: any = typeof globalThis !== 'undefined' ? globalThis : window

// ---------- Object ----------
if (typeof Object.hasOwn !== 'function') {
  ;(Object as any).hasOwn = function (o: object, k: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(o, k)
  }
}
if (typeof Object.fromEntries !== 'function') {
  ;(Object as any).fromEntries = function (entries: Iterable<[PropertyKey, unknown]>): Record<PropertyKey, unknown> {
    const out: Record<PropertyKey, unknown> = {}
    for (const [k, v] of entries as unknown as IterableIterator<[PropertyKey, unknown]>) out[k] = v
    return out
  }
}

// ---------- Array/TypedArray ----------
if (typeof Array.prototype.at !== 'function') {
  ;(Array.prototype as any).at = function (i: number): unknown {
    const len = Number(this.length)
    const idx = Math.trunc(i) || 0
    const k = idx < 0 ? len + idx : idx
    return k >= 0 && k < len ? this[k] : undefined
  }
  ;(String.prototype as any).at = (Array.prototype as any).at
}
if (typeof (Array.prototype as any).findLast !== 'function') {
  ;(Array.prototype as any).findLast = function (fn: (v: unknown, i: number, a: unknown[]) => boolean, thisArg?: unknown): unknown {
    for (let i = this.length - 1; i >= 0; i--) {
      if (fn.call(thisArg, this[i], i, this)) return this[i]
    }
    return undefined
  }
}
if (typeof (Array.prototype as any).findLastIndex !== 'function') {
  ;(Array.prototype as any).findLastIndex = function (fn: (v: unknown, i: number, a: unknown[]) => boolean, thisArg?: unknown): number {
    for (let i = this.length - 1; i >= 0; i--) {
      if (fn.call(thisArg, this[i], i, this)) return i
    }
    return -1
  }
}
if (typeof Array.prototype.flat !== 'function') {
  ;(Array.prototype as any).flat = function (depth: number = 1): unknown[] {
    const out: unknown[] = []
    const walk = (arr: unknown[], d: number): void => {
      for (const v of arr) {
        if (Array.isArray(v) && d > 0) walk(v, d - 1)
        else out.push(v)
      }
    }
    walk(this, depth)
    return out
  }
}
if (typeof Array.prototype.flatMap !== 'function') {
  ;(Array.prototype as any).flatMap = function (fn: (v: unknown, i: number, a: unknown[]) => unknown): unknown[] {
    return (this as unknown[]).map(fn).flat()
  }
}

/** نسخة آمنة من toSorted/toReversed/with للأجهزة القديمة (Chrome <110) */
if (typeof (Array.prototype as any).toSorted !== 'function') {
  ;(Array.prototype as any).toSorted = function (cmp?: (a: unknown, b: unknown) => number): unknown[] {
    return [...this].sort(cmp)
  }
}
if (typeof (Array.prototype as any).toReversed !== 'function') {
  ;(Array.prototype as any).toReversed = function (): unknown[] {
    return [...this].reverse()
  }
}
if (typeof (Array.prototype as any).toSpliced !== 'function') {
  ;(Array.prototype as any).toSpliced = function (start: number, deleteCount: number, ...items: unknown[]): unknown[] {
    const copy = [...this]
    copy.splice(start, deleteCount, ...items)
    return copy
  }
}

// ---------- Promise ----------
if (typeof Promise.allSettled !== 'function') {
  ;(Promise as any).allSettled = function (promises: Iterable<unknown>): Promise<Array<{ status: string; value?: unknown; reason?: unknown }>> {
    return Promise.all(
      Array.from(promises).map((p) =>
        Promise.resolve(p).then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason })
        )
      )
    )
  }
}
if (typeof Promise.any !== 'function') {
  ;(Promise as any).any = function (promises: Iterable<unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const list = Array.from(promises)
      let pending = list.length
      if (!pending) {
        reject(new (g.AggregateError || Error)('All promises were rejected'))
        return
      }
      const errors: unknown[] = []
      list.forEach((p, i) => {
        Promise.resolve(p).then(resolve, (err) => {
          errors[i] = err
          if (--pending === 0) {
            const AggErr = g.AggregateError
            if (typeof AggErr === 'function') reject(new AggErr(errors, 'All promises were rejected'))
            else reject(new Error('All promises were rejected'))
          }
        })
      })
    })
  }
}
if (typeof (Promise as any).withResolvers !== 'function') {
  ;(Promise as any).withResolvers = function <T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

// ---------- String ----------
if (typeof String.prototype.replaceAll !== 'function') {
  ;(String.prototype as any).replaceAll = function (search: string | RegExp, replace: string | ((m: string) => string)): string {
    if (search instanceof RegExp) {
      if (!search.global) throw new TypeError('replaceAll requires a global RegExp')
      return this.replace(search, replace as string)
    }
    return this.split(search).join(replace as string)
  }
}

// ---------- أنواع أساسية ----------
if (typeof (g as any).structuredClone !== 'function') {
  ;(g as any).structuredClone = function (value: unknown): unknown {
    // نسخة احتياطية عبر JSON — تكفي للبيانات النصية/الكائنية (لا ArrayBuffer/Map/Set)
    try {
      if (value instanceof ArrayBuffer) return value.slice(0)
      if (ArrayBuffer.isView(value)) return (value as DataViewLike).slice?.() ?? value
      if (value instanceof Map) return new Map(value)
      if (value instanceof Set) return new Set(value)
      return JSON.parse(JSON.stringify(value))
    } catch {
      return value
    }
  }
}
interface DataViewLike {
  slice?: (...args: unknown[]) => unknown
}

if (typeof (g as any).queueMicrotask !== 'function') {
  ;(g as any).queueMicrotask = function (fn: () => void): void {
    Promise.resolve()
      .then(fn)
      .catch((e) => setTimeout(() => { throw e }, 0))
  }
}

// ---------- crypto.randomUUID ----------
;(function ensureRandomUUID(): void {
  try {
    const c: any = g.crypto
    if (!c) return
    if (typeof c.randomUUID !== 'function') {
      c.randomUUID = function (): string {
        if (typeof c.getRandomValues === 'function') {
          const b = c.getRandomValues(new Uint8Array(16))
          b[6] = (b[6] & 0x0f) | 0x40
          b[8] = (b[8] & 0x3f) | 0x80
          const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
          return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
        }
        // أضعف احتمال — عشوائية رياضية
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
          const r = (Math.random() * 16) | 0
          const v = ch === 'x' ? r : (r & 0x3) | 0x8
          return v.toString(16)
        })
      }
    }
  } catch {
    /* ignore */
  }
})()
