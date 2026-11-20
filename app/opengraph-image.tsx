import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "MT Club";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "72px",
          background: "linear-gradient(135deg, #0f172a 0%, #1d4ed8 55%, #38bdf8 100%)",
          color: "white",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 96,
            height: 96,
            borderRadius: 24,
            background: "rgba(255,255,255,0.16)",
            fontSize: 40,
            fontWeight: 700,
            marginBottom: 28,
          }}
        >
          MT
        </div>
        <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05 }}>MT Club</div>
        <div style={{ fontSize: 34, marginTop: 20, maxWidth: 900, lineHeight: 1.3, color: "rgba(255,255,255,0.92)" }}>
          Learn, create, and grow together through Medical Technology.
        </div>
      </div>
    ),
    size,
  );
}
