/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.CHIBAKO_BUILD_DIR || ".next",
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: { bodySizeLimit: "8mb" }
  }
};

export default nextConfig;
