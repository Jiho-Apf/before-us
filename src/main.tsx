import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from "./app/App"
import './styles/index.css'
import { installGlobalErrorReporting } from './app/error-report'

document.documentElement.lang = 'ko'
installGlobalErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
