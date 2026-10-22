import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
import App from './App'

const saved = (() => { try { return localStorage.getItem('wgm-theme') } catch { return null } })()
if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved
else if (window.matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.dataset.theme = 'light'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
