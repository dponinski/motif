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

  // Next 16 builds with Turbopack, which needs no extra setup here; the webpack hook below applies to `--webpack` builds.
  turbopack: {},

  webpack: (config) => {
    // Fabric.js needs canvas module excluded in SSR
    config.externals = [...(config.externals || []), { canvas: 'canvas' }];
    return config;
  },
};

export default nextConfig;
