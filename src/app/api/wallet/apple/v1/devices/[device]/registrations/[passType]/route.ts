import { updatedSerials } from "@/server/stamp-card/apple-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ device: string; passType: string }> };

/** 1023, AC9 — Los pases del dispositivo que cambiaron desde `passesUpdatedSince`. */
export async function GET(req: Request, { params }: Params) {
  const { device, passType } = await params;
  return updatedSerials(device, passType, new URL(req.url).searchParams.get("passesUpdatedSince"));
}
