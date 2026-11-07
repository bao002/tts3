import { createFileRoute, redirect } from "@tanstack/react-router";

// Public alias: anyone (no sign-in) can open /api-docs to browse the API reference.
export const Route = createFileRoute("/api-docs")({
  beforeLoad: () => {
    throw redirect({ to: "/docs", replace: true });
  },
});
