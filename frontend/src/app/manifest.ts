import type { MetadataRoute } from "next";

// PWA manifest — served at /manifest.webmanifest by Next's metadata route.
// Colors match the dark identity (page background #0a0a0a). The 1024x1024
// app icon is reused at multiple sizes; "any maskable" keeps it safe on Android.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sylor — AI Simulation Platform",
    short_name: "Sylor",
    description:
      "Simulate major decisions before making them using multi-agent AI Monte Carlo simulations.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: "/icon.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
