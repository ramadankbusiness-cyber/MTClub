import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { joinApplicationSchema } from "@/lib/schemas";
import { prisma } from "@/lib/prisma";
import { createImmediateNotification } from "@/lib/notification-delivery";

type StoredJoinApplication = {
  name: string;
  email: string;
  academicNumber: string;
  phone: string;
  committees: string[];
  submittedAt: string;
};

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return { url, key };
}

async function notifyAdminsOfApplication(application: StoredJoinApplication) {
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
      message: `Applicant: ${application.name}\nAcademic number: ${application.academicNumber}\nPhone: ${application.phone}\nCommittees: ${committees}\nSubmitted: ${submittedLabel}`,
      messageAr: `المتقدم: ${application.name}\nالرقم الأكاديمي: ${application.academicNumber}\nالهاتف: ${application.phone}\nاللجان: ${committees}\nوقت التقديم: ${submittedLabel}`,
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

function isMissingColumnError(message: string) {
  return /column .* does not exist|Could not find the .* column|schema cache/i.test(message);
}

async function POSTInternal(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = joinApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please provide valid application details" }, { status: 400 });
  }
  const application = parsed.data;

  const { url: supabaseUrl, key: supabaseKey } = supabaseConfig();
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Application service is temporarily unavailable. Please try again later." }, { status: 503 });
  }

  const submittedAt = new Date().toISOString();
  const storedApplication = {
    name: application.name,
    email: application.email,
    phone: application.phone,
    phone_number: application.phone,
    academic_number: application.academicNumber,
    academicNumber: application.academicNumber,
    committees: application.committees,
    message: application.message,
    submitted_at: submittedAt,
    created_at: submittedAt,
  };

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Best-effort duplicate prevention (does not prove storage success).
  try {
    const recentCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("join_applications")
      .select("id, email, phone, phone_number, academic_number, academicNumber, created_at")
      .eq("email", application.email)
      .gte("created_at", recentCutoff)
      .limit(5);
    if (Array.isArray(recent) && recent.some((row) => (row.phone ?? row.phone_number) === application.phone || (row.academicNumber ?? row.academic_number) === application.academicNumber)) {
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }
  } catch {
    // Continue with insert if duplicate lookup is unsupported by current schema/policy.
  }

  const { error: storageError } = await supabase.from("join_applications").insert(storedApplication).select("id").single();
  if (storageError) {
    console.error("[Join] Failed to store application", { message: storageError.message, code: storageError.code });
    if (isMissingColumnError(storageError.message)) {
      return NextResponse.json({ error: "Application could not be stored because the application form fields are not fully supported yet. Please try again later." }, { status: 503 });
    }
    return NextResponse.json({ error: "Application could not be stored. Please try again later." }, { status: 503 });
  }

  await notifyAdminsOfApplication({
    name: application.name,
    email: application.email,
    academicNumber: application.academicNumber,
    phone: application.phone,
    committees: application.committees,
    submittedAt,
  });

  const destination = process.env.JOIN_WEBHOOK_URL?.trim();
  if (destination) {
    let webhook: URL;
    try {
      webhook = new URL(destination);
      if (webhook.protocol !== "https:" && webhook.protocol !== "http:") throw new Error("Unsupported protocol");
    } catch {
      console.error("[Join] JOIN_WEBHOOK_URL is invalid");
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
