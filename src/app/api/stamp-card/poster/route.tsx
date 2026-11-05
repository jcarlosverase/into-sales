import { ImageResponse } from "next/og";
import { apiError, withAuth } from "@/lib/api";
import { stampCardDisabledResponse, stampCardEnabled } from "@/server/stamp-card/flag";
import { posterData } from "@/server/stamp-card/poster";

export const dynamic = "force-dynamic";

/** 1023, AC13 — El cartel del mostrador en PNG (1200 × 1600), listo para imprimir. */
export const GET = withAuth(async (session) => {
  if (!stampCardEnabled()) return stampCardDisabledResponse();
  const poster = await posterData(session.organizationId);
  if (!poster) return apiError(409, "poster_unavailable", "Guarda la tarjeta y conecta tu número de WhatsApp primero");
  const qr = `data:image/svg+xml;base64,${Buffer.from(poster.qrSvg).toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "90px 80px",
          backgroundColor: poster.color,
          color: poster.ink,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <div style={{ fontSize: 72, fontWeight: 700 }}>{poster.name}</div>
          <div style={{ fontSize: 44, marginTop: 24 }}>{`Junta ${poster.stampsRequired} sellos y llévate ${poster.reward}`}</div>
        </div>
        <div style={{ display: "flex", padding: 28, backgroundColor: "#ffffff", borderRadius: 32 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} width={640} height={640} alt="" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>Escanea y envía por WhatsApp:</div>
          <div style={{ fontSize: 48, fontWeight: 700, marginTop: 16 }}>{`«${poster.phrase}»`}</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 1600,
      headers: {
        "content-disposition": 'attachment; filename="cartel-tarjeta-de-sellos.png"',
        "cache-control": "private, no-store",
      },
    }
  );
});
