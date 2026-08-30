/// <reference types="vite/client" />

declare module '*?worker&inline' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}

declare module 'epubjs/types/*' {
  const value: unknown
  export default value
}

interface BootGuardApi {
  stage(name: string): void
  done(): void
  fail(e: unknown): void
  isVisible(): boolean
}

interface Window {
  __mkBoot?: BootGuardApi
}
