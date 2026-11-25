import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/auth-guards";
import { getStorageDriver } from "@/lib/image-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getProjectRef(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const hostname = new URL(supabaseUrl).hostname.toLowerCase();
    const match = hostname.match(/^([a-z0-9-]+)\.supabase\.co$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

type DiagnosticResponse = {
  projectRef: string | null;
  configuredBucket: string;
  bucketExists: boolean;
  bucketPublic: boolean | null;
  storageDriver: string;
};

function response(body: DiagnosticResponse, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  const configuredBucket = process.env.SUPABASE_STORAGE_BUCKET || "club-assets";
  const storageDriver = getStorageDriver();

  try {
    const access = await requirePermission("permissions.read");
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status, headers: { "Cache-Control": "no-store" } },
      );
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY;
    const projectRef = getProjectRef(supabaseUrl);

    if (!supabaseUrl || !supabaseKey) {
      return response({
        projectRef,
        configuredBucket,
        bucketExists: false,
        bucketPublic: null,
        storageDriver,
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.storage.listBuckets();

    if (error || !Array.isArray(data)) {
      console.error("[Admin storage diagnostic] Bucket lookup failed");
      return response({
        projectRef,
        configuredBucket,
        bucketExists: false,
        bucketPublic: null,
        storageDriver,
      });
    }

    const bucket = data.find((item) => item.name === configuredBucket);
    return response({
      projectRef,
      configuredBucket,
      bucketExists: !!bucket,
      bucketPublic: bucket ? !!bucket.public : null,
      storageDriver,
    });
  } catch {
    console.error("[Admin storage diagnostic] Unexpected failure");
    return response({
      projectRef: getProjectRef(process.env.SUPABASE_URL),
      configuredBucket,
      bucketExists: false,
      bucketPublic: null,
      storageDriver,
    });
  }
}
