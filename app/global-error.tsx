"use client";

import { useEffect } from "react";
import { BrandedErrorScreen } from "@/components/branded-error-screen";
import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[Global layout error]", { digest: error.digest }, error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <BrandedErrorScreen variant="500" errorId={error.digest} onRetry={reset} />
      </body>
    </html>
  );
}
