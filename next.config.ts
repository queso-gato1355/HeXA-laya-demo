import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Laya never runs inside Next.js (it lives in laya-service); keep these out of any server bundle anyway.
  serverExternalPackages: ["@receptron/laya", "onnxruntime-node"],
  reactStrictMode: true,
  devIndicators: false,
};

export default nextConfig;
