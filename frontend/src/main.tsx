import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { CacheProvider } from '@emotion/react'
import createCache from '@emotion/cache'
import App from './App'
import './styles/globals.css'
import './i18n/config' // Initialize i18n

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

// Create QueryClient with sensible defaults
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale time: How long data is considered fresh (default: 0 = always stale)
      staleTime: 0,
      // Cache time: How long unused data stays in cache (10 minutes)
      gcTime: 10 * 60 * 1000,
      // Retry failed requests 1 time
      retry: 1,
      // Refetch on window focus
      refetchOnWindowFocus: true,
      // Refetch on mount if data is stale
      refetchOnMount: true,
    },
    mutations: {
      // Retry failed mutations 0 times by default
      retry: 0,
    },
  },
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
