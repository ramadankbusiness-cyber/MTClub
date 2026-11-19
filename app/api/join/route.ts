import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { joinApplicationSchema } from "@/lib/schemas";
import { prisma } from "@/lib/prisma";
import { createImmediateNotification } from "@/lib/notification-delivery";

async function notifyAdminsOfApplication(application: {
  name: string;
  email: string;
  academicNumber: string;
  committees: string[];
  submittedAt: string;
}) {
  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
    });
    if (!admins.length) return;
    const submittedLabel = new Date(application.submittedAt).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
    const committees = application.committees.join(", ");
    await createImmediateNotification({
      title: `New membership application: ${application.name}`,
      titleAr: `طلب انضمام جديد: ${application.name}`,
      message: `Applicant: ${application.name}\nAcademic number: ${application.academicNumber}\nCommittees: ${committees}\nSubmitted: ${submittedLabel}`,
      messageAr: `المتقدم: ${application.name}\nالرقم الأكاديمي: ${application.academicNumber}\nاللجان: ${committees}\nوقت التقديم: ${submittedLabel}`,
      link: "/admin/applications",
      type: "ANNOUNCEMENT",
      audience: "USERS",
      committeeId: null,
      createdById: admins[0].id,
      userIds: admins.map((admin) => admin.id),
    });
  } catch (error) {
    console.error("[Join] Failed to notify admins", error instanceof Error ? error.message : "unknown error");
  }
}

async function POSTInternal(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = joinApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please provide valid application details" }, { status: 400 });
  }
  const application = parsed.data;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Application storage is not configured" }, { status: 503 });
  }

  const submittedAt = new Date().toISOString();
  const storedApplication = {
    name: application.name,
    email: application.email,
    academic_number: application.academicNumber,
    academicNumber: application.academicNumber,
    committees: application.committees,
    message: application.message,
    submitted_at: submittedAt,
  };

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Best-effort duplicate prevention to avoid repeated submissions/notifications.
  try {
    const recentCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("join_applications")
      .select("id, created_at, email, academic_number, academicNumber")
      .or(`email.eq.${application.email},academic_number.eq.${application.academicNumber},academicNumber.eq.${application.academicNumber}`)
      .gte("created_at", recentCutoff)
      .limit(1);
    if (Array.isArray(recent) && recent.length > 0) {
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }
  } catch {
    // Continue with insert if duplicate check is unsupported by the current table schema.
  }

  const { error: storageError } = await supabase.from("join_applications").insert(storedApplication);
  if (storageError) {
    console.error("[Join] Failed to store application", storageError.message);
    return NextResponse.json({ error: "Application could not be stored" }, { status: 503 });
  }

  await notifyAdminsOfApplication({
    name: application.name,
    email: application.email,
    academicNumber: application.academicNumber,
    committees: application.committees,
    submittedAt,
  });

  const destination = process.env.JOIN_WEBHOOK_URL;
  if (destination) {
    let webhook: URL;
    try {
      webhook = new URL(destination);
      if (webhook.protocol !== "https:" && webhook.protocol !== "http:") throw new Error("Unsupported protocol");
    } catch {
      console.error("[Join] JOIN_WEBHOOK_URL must be a valid HTTP(S) URL");
      return NextResponse.json({ ok: true, forwarded: false }, { status: 201 });
    }

    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...application, submittedAt }),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (!response.ok) {
        console.error(`[Join] Submission destination returned ${response.status}`);
        return NextResponse.json({ ok: true, forwarded: false }, { status: 201 });
      }
      return NextResponse.json({ ok: true, forwarded: true }, { status: 201 });
    } catch (error) {
      console.error("[Join] Failed to forward application", error instanceof Error ? error.message : "unknown error");
      return NextResponse.json({ ok: true, forwarded: false }, { status: 201 });
    }
  }

  return NextResponse.json({ ok: true, forwarded: false }, { status: 201 });
}

export const POST = withApiErrorHandling(POSTInternal, "/api/join");
