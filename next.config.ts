import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable static export for Tauri desktop builds
  // Comment out for server-based deployment
  // output: 'export',

  // Allow Tauri to load assets correctly
  assetPrefix: process.env.TAURI_ENV === 'true' ? '.' : undefined,

  // Disable image optimization for desktop builds
  images: {
    unoptimized: process.env.TAURI_ENV === 'true',
  },

  webpack: (config) => {
    // Fabric.js needs canvas module excluded in SSR
    config.externals = [...(config.externals || []), { canvas: 'canvas' }];
    return config;
  },
};

export default nextConfig;
