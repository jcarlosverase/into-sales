import type { Instrumentation } from "next";

/**
 * Hook de arranque de Next. El trabajo real vive en instrumentation-node.ts
 * (import dinámico condicionado al runtime para que el bundler edge no
 * intente resolver dependencias de Node como `postgres`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startLogging, checkMediaDir, cleanupOrphanRuns, resumeDispatch, startHeartbeatCentral } =
      await import("./instrumentation-node");
    startLogging();
    await checkMediaDir();
    await cleanupOrphanRuns();
    resumeDispatch();
    startHeartbeatCentral();
  }
}

/** Next calls this on every uncaught server error (spec 1006). */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logRequestError } = await import("./instrumentation-node");
    logRequestError(error, request, context);
  }
};
