import { withApiErrorHandling } from "@/lib/api-error-handler";
import { getCurrentUser, isAccountLinkingComplete } from "@/lib/auth-guards";
import { countUnreadForUser } from "@/lib/notification-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function GETInternal() {
  const user = await getCurrentUser();
  if (!user?.isActive || user.mustChangePassword) return new Response("Unauthorized", { status: 401 });
  if (!isAccountLinkingComplete(user)) return new Response("Forbidden", { status: 403 });

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const stop = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    if (timeout) clearTimeout(timeout);
    controller.close();
  };
  const stream = new ReadableStream({
    start(controller) {
      const send = async () => {
        if (closed) return;
        try {
          const unreadCount = await countUnreadForUser(user.id);
          controller.enqueue(encoder.encode(`event: refresh\ndata: ${JSON.stringify({ unreadCount })}\n\n`));
        } catch (error) {
          console.error("[Notifications SSE] Refresh failed", error);
          if (!closed) controller.enqueue(encoder.encode("event: refresh\ndata: {}\n\n"));
        }
      };
      void send();
      timer = setInterval(() => void send(), 15_000);
      timeout = setTimeout(() => stop(controller), 55_000);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
      if (timeout) clearTimeout(timeout);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const GET = withApiErrorHandling(GETInternal, "/api/notifications/stream");
