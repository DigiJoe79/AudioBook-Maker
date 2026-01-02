import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { CacheProvider } from '@emotion/react'
import createCache from '@emotion/cache'
import App from './App'
import './styles/globals.css'
import './i18n/config' // Initialize i18n
import { queryClient } from '@services/queryClient'

// Get the CSP nonce injected by Tauri
// Tauri 2.0 automatically adds a nonce to the CSP, which makes 'unsafe-inline' ignored
// We need to tell Emotion to use this nonce for its inline styles
function getNonce(): string | undefined {
  // In Tauri 2.0, the nonce is available on the window object
  return (window as any).__TAURI_NONCE__
}

// Create Emotion cache for Material-UI styles
// This ensures styles work correctly in production builds with Tauri's CSP
const emotionCache = createCache({
  key: 'css',
  prepend: true,
  nonce: getNonce(),
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CacheProvider value={emotionCache}>
      <QueryClientProvider client={queryClient}>
        <App />
        {/* React Query DevTools - only in development */}
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </CacheProvider>
  </React.StrictMode>,
)
