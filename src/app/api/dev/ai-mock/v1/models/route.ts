import { mockGuard } from "@/lib/dev-guard";
import { aiMockAuthFailure, aiMockModels } from "@/server/dev/ai-mock";

export const dynamic = "force-dynamic";

/** `GET /v1/models` del ai-mock, con la misma forma que OpenRouter/OpenAI. */
export async function GET(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const rejection = aiMockAuthFailure(req.headers.get("authorization"));
  if (rejection) return Response.json(rejection.body, { status: rejection.status });

  return Response.json({ data: aiMockModels() });
}
