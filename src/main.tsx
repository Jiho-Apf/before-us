import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from "./app/App"
import './styles/index.css'
import { installGlobalErrorReporting } from './app/error-report'
import { captureSource } from './app/acquisition'

document.documentElement.lang = 'ko'
installGlobalErrorReporting()
captureSource()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
