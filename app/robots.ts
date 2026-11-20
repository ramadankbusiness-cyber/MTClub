import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/en/admin",
          "/ar/admin",
          "/en/dashboard",
          "/ar/dashboard",
          "/en/login",
          "/ar/login",
          "/en/attendance",
          "/ar/attendance",
          "/en/notifications",
          "/ar/notifications",
          "/en/profile",
          "/ar/profile",
          "/en/excuses",
          "/ar/excuses",
          "/en/change-password",
          "/ar/change-password",
          "/en/scan",
          "/ar/scan",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: "https://mtclub.vercel.app",
  };
}
