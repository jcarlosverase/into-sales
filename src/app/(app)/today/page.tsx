import { TodayClient } from "@/components/today/today-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hoy" };

/** 029 — A quién llamar hoy. */
export default function TodayPage() {
  return <TodayClient />;
}
