"use client";

import { useEffect, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * 030 — Importar contactos desde Excel o CSV en dos pasos: vista previa
 * (columnas, conteos y ejemplos) e importación. El archivo se manda las dos
 * veces y el servidor no lo guarda (D6).
 */

type Field = "name" | "phone" | "notes" | "stage";
type Mapping = Record<Field, number | null>;
type Status = "ok" | "exists" | "duplicate" | "invalid_phone";
type Row = { row: number; name: string; phone: string | null; rawPhone: string; status: Status };
type Preview = {
  headers: string[];
  mapping: Mapping;
  countryCode: string;
  totalRows: number;
  counts: Record<Status, number>;
  sample: Row[];
  problems: Row[];
};
type Result = { created: number; counts: Record<Status, number>; skipped: { row: number; name: string; rawPhone: string; status: Exclude<Status, "ok"> }[] };

const FIELDS: { key: Field; label: string; required?: boolean }[] = [
  { key: "name", label: "Nombre" },
  { key: "phone", label: "Teléfono", required: true },
  { key: "notes", label: "Notas" },
  { key: "stage", label: "Etapa" },
];

export const STATUS_LABEL: Record<Status, string> = {
  ok: "Entra",
  exists: "Ya existe",
  duplicate: "Repetido en el archivo",
  invalid_phone: "Teléfono inválido",
};

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [countryCode, setCountryCode] = useState("");
  const [assign, setAssign] = useState("turno");
  const [team, setTeam] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Supervisores eligen a quién van los leads; un vendedor se los queda (D5).
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/today").catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as { canFilter: boolean; team: { id: string; name: string }[] };
      setTeam(data.canFilter ? data.team : null);
    })();
  }, []);

  function body(extra: Record<string, string> = {}) {
    const form = new FormData();
    form.set("file", file!);
    if (mapping) form.set("mapping", JSON.stringify(mapping));
    if (countryCode) form.set("countryCode", countryCode);
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return form;
  }

  async function loadPreview(nextMapping: Mapping | null = mapping, nextCode = countryCode, nextFile = file) {
    if (!nextFile) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", nextFile);
    if (nextMapping) form.set("mapping", JSON.stringify(nextMapping));
    if (nextCode) form.set("countryCode", nextCode);
    const res = await fetch("/api/contacts/import/preview", { method: "POST", body: form }).catch(() => null);
    setBusy(false);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res?.ok) {
      setPreview(null);
      setError(data?.error?.message ?? "No se pudo leer el archivo");
      return;
    }
    setPreview(data as Preview);
    setMapping((data as Preview).mapping);
    setCountryCode((data as Preview).countryCode);
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/contacts/import", { method: "POST", body: body({ assign }) }).catch(() => null);
    setBusy(false);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res?.ok) {
      setError(data?.error?.message ?? "No se pudo importar");
      return;
    }
    setResult(data as Result);
    onImported();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Importar contactos"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold">Importar contactos</h3>
        <p className="mb-4 text-xs text-text-3">
          Desde una hoja de Excel (.xlsx) o un CSV, hasta 2 000 filas. Los que ya existen no se tocan y nada se importa
          sin que veas antes cómo queda.
        </p>

        {result ? (
          <div className="space-y-3" data-testid="import-result">
            <p className="text-sm font-medium text-success-text">
              {result.created === 1 ? "1 contacto importado" : `${result.created} contactos importados`}, cada uno con su lead.
            </p>
            <p className="text-xs text-text-3">
              Ya existían {result.counts.exists} · repetidos en el archivo {result.counts.duplicate} · teléfono inválido{" "}
              {result.counts.invalid_phone}
            </p>
            {result.skipped.length > 0 ? (
              <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border p-2 text-xs">
                {result.skipped.map((s) => (
                  <li key={s.row} className="break-words">
                    Fila {s.row}: {s.name} {s.rawPhone ? `(${s.rawPhone})` : ""} — {STATUS_LABEL[s.status]}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex justify-end">
              <Button onClick={onClose}>Listo</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed p-3 text-sm hover:bg-accent">
              <FileUp className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{file ? file.name : "Elegir archivo .xlsx o .csv"}</span>
              <input
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                aria-label="Archivo a importar"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  setMapping(null);
                  setPreview(null);
                  if (f) void loadPreview(null, countryCode, f);
                }}
              />
            </label>

            {preview && mapping ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {FIELDS.map((f) => (
                    <label key={f.key} className="space-y-1 text-sm">
                      <span className="font-medium">
                        {f.label}
                        {f.required ? " *" : ""}
                      </span>
                      <select
                        aria-label={`Columna de ${f.label}`}
                        value={mapping[f.key] ?? ""}
                        onChange={(e) => {
                          const next = { ...mapping, [f.key]: e.target.value === "" ? null : Number(e.target.value) };
                          setMapping(next);
                          if (next.phone !== null) void loadPreview(next);
                        }}
                        className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                      >
                        <option value="">{f.required ? "Elige una columna" : "No importar"}</option>
                        {preview.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `Columna ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label className="space-y-1 text-sm">
                    <span className="font-medium">Código de país</span>
                    <Input
                      aria-label="Código de país"
                      inputMode="numeric"
                      value={countryCode}
                      placeholder="p. ej. 51"
                      onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      onBlur={() => void loadPreview()}
                    />
                    <span className="block text-xs text-text-3">Para los números sin código (10 dígitos o menos).</span>
                  </label>
                  {team ? (
                    <label className="space-y-1 text-sm">
                      <span className="font-medium">Los leads van a</span>
                      <select
                        aria-label="A quién van los leads"
                        value={assign}
                        onChange={(e) => setAssign(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                      >
                        <option value="turno">Repartir por turno</option>
                        <option value="ninguno">Sin asignar</option>
                        {team.map((m) => (
                          <option key={m.id} value={`user:${m.id}`}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="self-end text-xs text-text-3">Los leads que importes quedan asignados a ti.</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4" data-testid="import-counts">
                  {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                    <div key={s} className={cn("rounded-md border p-2", s === "ok" && "border-success-soft bg-success-tint")}>
                      <div className="text-lg font-semibold">{preview.counts[s]}</div>
                      <div className="text-text-3">{STATUS_LABEL[s]}</div>
                    </div>
                  ))}
                </div>

                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[28rem] text-left text-xs">
                    <thead className="bg-secondary text-text-2">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Fila</th>
                        <th className="px-2 py-1.5 font-medium">Nombre</th>
                        <th className="px-2 py-1.5 font-medium">Teléfono</th>
                        <th className="px-2 py-1.5 font-medium">Queda</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...preview.sample, ...preview.problems.filter((p) => !preview.sample.some((s) => s.row === p.row))].map((r) => (
                        <tr key={r.row} className="border-t" data-testid="import-row">
                          <td className="px-2 py-1">{r.row}</td>
                          <td className="max-w-[10rem] truncate px-2 py-1">{r.name}</td>
                          <td className="px-2 py-1 font-mono">{r.phone ?? r.rawPhone}</td>
                          <td className={cn("px-2 py-1", r.status === "ok" ? "text-success-text" : "text-warning-text")}>{STATUS_LABEL[r.status]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-danger-text">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button disabled={!preview || busy || preview.counts.ok === 0} onClick={() => void runImport()}>
                {busy ? "Procesando…" : preview ? `Importar ${preview.counts.ok}` : "Importar"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
