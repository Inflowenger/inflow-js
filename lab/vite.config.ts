import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The lab consumes the packages exactly as an installed app does — through
// their `workspace:*` dist entrypoints, not their src. That is the point: it
// exercises the published surface (exports map, types, style.css), so a broken
// build shows up here rather than in someone else's app. Run `pnpm -r build`
// first, or `pnpm --filter <pkg> dev` alongside for a rebuild-on-save loop.
export default defineConfig({
  plugins: [vue()],
})
