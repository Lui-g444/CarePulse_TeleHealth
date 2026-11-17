import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  reloadOnOnline: true,
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  customWorkerSrc: "worker",
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
  },
});

/** @type {import("next").NextConfig} */
const nextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // next-pwa injects a webpack config; this tells Next 16 that Turbopack (dev)
  // is intentional. CSS is handled by @tailwindcss/postcss for both bundlers.
  turbopack: {},
};

export default withPWA(nextConfig);
