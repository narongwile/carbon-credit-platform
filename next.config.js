/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,          // static export routing ถูกต้อง
  transpilePackages: ['three'],
  images: { unoptimized: true },
}

module.exports = nextConfig
