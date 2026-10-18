import path from "node:path";

/** @type {import('next').NextConfig} */
const rawBuildDir = process.env.CHIBAKO_BUILD_DIR;
// Next joins distDir onto the project dir, so an absolute value nests inside the repo.
const distDir = rawBuildDir && path.isAbsolute(rawBuildDir)
  ? path.relative(process.cwd(), rawBuildDir)
  : rawBuildDir || ".next";

const nextConfig = {
  distDir,
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: { bodySizeLimit: "8mb" }
  }
};

export default nextConfig;
