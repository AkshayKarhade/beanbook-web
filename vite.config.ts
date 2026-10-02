import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// BeanBook is served from /beanbook while the public website
// occupies the root of the Netlify site.
export default defineConfig({
  plugins: [react()],
  base: '/beanbook/',
  build: {
    outDir: 'dist/beanbook',
  },
})
