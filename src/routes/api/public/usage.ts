import { createFileRoute } from "@tanstack/react-router";
import { getUsageReport, usageReportCorsHeaders } from "@/lib/usage-report.server";

export const Route = createFileRoute("/api/public/usage")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: usageReportCorsHeaders }),
      GET: async ({ request }) => getUsageReport(request),
    },
  },
});
