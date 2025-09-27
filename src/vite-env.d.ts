/// <reference types="vite/client" />

// Extend Window with our preload-exposed API
declare global {
  interface Window {
    api: {
      ping: () => string
    }
  }
}

export {}
