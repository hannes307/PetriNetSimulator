import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // your repo name ↓
  base: '/PetriNetSimulator/',
})


