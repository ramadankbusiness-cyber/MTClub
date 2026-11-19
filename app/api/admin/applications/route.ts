import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CLUB_COMMITTEES } from "@/data/committees";
import { requirePermission } from "@/lib/auth-guards";

async function GETInternal(request: Request) {
  const access = await requirePermission("applications.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const committee = new URL(request.url).searchParams.get("committee");
  if (committee && !(CLUB_COMMITTEES as readonly string[]).includes(committee)) {
    return NextResponse.json({ error: "Choose a valid committee filter." }, { status: 400 });
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Application storage is not configured." }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  let query = supabase
    .from("join_applications")
    .select("id, name, email, phone, phone_number, academic_number, academicNumber, committees, message, created_at")
    .order("created_at", { ascending: false });
  if (committee) query = query.contains("committees", [committee]);
  const { data, error } = await query;
  if (error) {
    console.error("[Admin applications] Failed to load applications", error.message);
    return NextResponse.json({ error: "Could not load membership applications." }, { status: 503 });
  }
  const applications = (data ?? []).map((application) => ({
    ...application,
    phone: application.phone ?? application.phone_number ?? null,
    academicNumber: application.academicNumber ?? application.academic_number ?? null,
  }));
  return NextResponse.json({ applications }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withApiErrorHandling(GETInternal, "/api/admin/applications");
