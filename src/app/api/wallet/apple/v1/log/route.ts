import { receiveLog } from "@/server/stamp-card/apple-service";

export const dynamic = "force-dynamic";

/** 1023, AC9 — Los errores que reporta Wallet (solo se cuentan). */
export async function POST(req: Request) {
  return receiveLog(req);
}
