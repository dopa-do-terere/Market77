import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Market77 PDV",
    short_name: "PDV",
    start_url: "/pdv",
    display: "fullscreen",
    background_color: "#ffffff",
    theme_color: "#ffffff",
  };
}
