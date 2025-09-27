import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

declare global {
  interface Window { __kiisuLoaderStart?: number }
}

// Optional: quick preload API smoke test
try {
  // Call and ignore the result; will be available for debugging if needed
  void window.api?.ping?.()
} catch (e) {
  /* ignore */
}

const rootEl = document.getElementById('root')!
createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Loader removal logic
function dismissLoader(){
  const minDuration = 1000; // ms
  const start = window.__kiisuLoaderStart || performance.now();
  const elapsed = performance.now() - start;
  const remaining = Math.max(0, minDuration - elapsed);
  const loader = document.getElementById('app-loader');
  if(!loader) return;
  setTimeout(()=>{
    loader.classList.add('fade-out');
    // After transition hide fully
    setTimeout(()=>{
      loader.classList.add('done');
      document.body.classList.add('loader-fade-complete');
      document.body.classList.remove('loading');
      document.documentElement.classList.remove('loading');
    }, 650);
  }, remaining);
}

// Wait for window load (assets) and a microtask after React render
if(document.readyState === 'complete') {
  dismissLoader();
} else {
  window.addEventListener('load', dismissLoader, { once: true });
}
