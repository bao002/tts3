import { createFileRoute } from "@tanstack/react-router";
import { ttsHandlers } from "@/lib/tts-handler.server";

export const Route = createFileRoute("/api/auto")({
  server: { handlers: ttsHandlers("auto") },
});
