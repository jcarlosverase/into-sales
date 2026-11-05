import { latestPass } from "@/server/stamp-card/apple-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ passType: string; serial: string }> };

/** 1023, AC9 — La última versión del pase. */
export async function GET(req: Request, { params }: Params) {
  const { passType, serial } = await params;
  return latestPass(req, passType, serial);
}
