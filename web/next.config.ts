import type { NextConfig } from 'next';

// Static export: the whole web app is plain files, served from S3 + CloudFront on AWS.
// All data comes from the API at NEXT_PUBLIC_API_URL.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};
export default nextConfig;
