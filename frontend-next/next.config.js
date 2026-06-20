/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,          // static export routing ถูกต้อง
  transpilePackages: ['three'],
  images: { unoptimized: true },
  // Lint is a dedicated CI gate (test_frontend job), not a blocker for the
  // production image build — keeps `next build` deterministic.
  eslint: { ignoreDuringBuilds: true },
}

module.exports = nextConfig
