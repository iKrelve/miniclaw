import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  entry: ['src/main.tsx'],
  project: ['src/**/*.{ts,tsx}', 'shared/**/*.ts'],
  ignoreDependencies: [
    // Tauri — runtime injected, not statically importable
    '@tauri-apps/cli',
    // CLI tools used in scripts only
    'oxlint',
    'oxfmt',
    'lefthook',
    // Tailwind CSS consumed via Vite plugin
    'tailwindcss',
    '@tailwindcss/vite',
    // PostCSS / autoprefixer — build tooling
    'postcss',
    'autoprefixer',
    // @types packages consumed implicitly by TypeScript
    '@types/.*',
  ],
}

export default config
