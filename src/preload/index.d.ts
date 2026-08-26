import type { ApiBridge } from '../shared/types'

declare global {
  interface Window {
    api: ApiBridge
  }
}

export {}
