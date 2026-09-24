import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <TRPCProvider>
      <App />
    </TRPCProvider>
  </BrowserRouter>,
)

// PWA: cache the static app shell for offline/flaky-network resilience.
// Registered after load so it never competes with the initial page render.
// Production only — in dev, Vite serves unhashed module URLs that stay the
// same across restarts even when the file content changes, so a cache-first
// service worker there just serves stale code with no visible sign why.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Non-fatal — the site works fine without the service worker.
    })
  })
}
