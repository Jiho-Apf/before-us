import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const reactDirectory = path.dirname(require.resolve('react/package.json'))
const reactDomDirectory = path.dirname(require.resolve('react-dom/package.json'))

export default defineConfig({
  cacheDir: 'node_modules/.vite-before-us',
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      'react': reactDirectory,
      'react-dom': reactDomDirectory,
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    entries: ['src/main.tsx'],
    force: true,
    holdUntilCrawlEnd: true,
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-router',
      'motion/react',
      '@radix-ui/react-slot',
      '@radix-ui/react-accordion',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-select',
    ],
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
