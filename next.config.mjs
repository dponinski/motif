/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable static export for Tauri desktop builds
  // Comment out for server-based deployment
  // output: 'export',

  // Allow Tauri to load assets correctly
  assetPrefix: process.env.TAURI_ENV === 'true' ? '.' : undefined,

  // Disable image optimization for desktop builds
  images: {
    unoptimized: process.env.TAURI_ENV === 'true',
  },

  // Next 16 builds with Turbopack by default; `npm run build` uses `--webpack`. Neither needs extra setup here.
  turbopack: {},
};

export default nextConfig;
