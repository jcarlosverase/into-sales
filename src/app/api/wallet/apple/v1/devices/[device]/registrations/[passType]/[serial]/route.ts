import { registerDevice, unregisterDevice } from "@/server/stamp-card/apple-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ device: string; passType: string; serial: string }> };

/** 1023, AC9 — Apple registra el pase en un dispositivo. */
export async function POST(req: Request, { params }: Params) {
  const { device, passType, serial } = await params;
  return registerDevice(req, device, passType, serial);
}

/** 1023, AC9 — Apple da de baja el pase (lo borraron del iPhone). */
export async function DELETE(req: Request, { params }: Params) {
  const { device, passType, serial } = await params;
  return unregisterDevice(req, device, passType, serial);
}
