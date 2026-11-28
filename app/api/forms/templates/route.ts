import { withApiErrorHandling } from "@/lib/api-error-handler";
import { NextResponse } from "next/server";
import { SYSTEM_FORM_TEMPLATES } from "@/lib/form-templates";

async function GETInternal() {
  return NextResponse.json({ templates: SYSTEM_FORM_TEMPLATES });
}

export const GET = withApiErrorHandling(GETInternal, "/api/forms/templates");
