"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { qualificationEntries, qualificationLabel, qualificationValueText, parseQualificationValue } from "@/lib/qualification";
import type { QualificationDto, QualificationValue } from "@/lib/types";

/**
 * Lo que se sabe del lead, donde se trabaja la conversación.
 *
 * Existe porque `PUT /api/bot/ficha` ya deja al agente guardar lo que
 * averigua: sin esta pantalla, eso era un cajón que se llenaba y no se abría.
 *
 * Se puede corregir a mano. Un dato equivocado que el dueño ve pero no puede
 * arreglar es peor que no tenerlo: enseña a desconfiar de toda la ficha.
 */
export function QualificationPanel({
  ficha: qualification,
  onSave,
}: {
  ficha: QualificationDto;
  /** Parche: solo lo que cambia. `null` borra la clave. */
  onSave: (patch: Record<string, QualificationValue | null>) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);

  const entries = qualificationEntries(qualification);

  async function save(patch: Record<string, QualificationValue | null>) {
    setSaving(true);
    try {
      await onSave(patch);
    } finally {
      setSaving(false);
    }
  }

  async function confirmEdit(key: string) {
    const value = parseQualificationValue(draft, qualification[key]);
    setEditing(null);
    // Vacío no borra: para eso está el bote de basura. Un campo que se vacía
    // solo, porque alguien seleccionó y salió, se lleva un dato que costó una
    // conversación.
    if (value === "" || value === qualification[key]) return;
    await save({ [key]: value });
  }

  async function add() {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key || !value) return;
    setAdding(false);
    setNewKey("");
    setNewValue("");
    await save({ [key]: value });
  }

  return (
    <section className="border-b p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="kicker">
          Ficha
        </p>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-3 hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Agregar
          </button>
        )}
      </div>

      {entries.length === 0 && !adding && (
        <p className="text-xs leading-relaxed text-text-3">
          Todavía vacía. Aquí aparece lo que tu agente va averiguando del lead
          mientras conversa — y puedes escribirlo tú.
        </p>
      )}

      {entries.length > 0 && (
        <dl className="space-y-1.5">
          {entries.map(([key, value]) => (
            <div key={key} className="group flex items-start gap-2 text-xs">
              <dt className="w-[38%] shrink-0 pt-1 text-text-3">
                {qualificationLabel(key)}
              </dt>
              <dd className="flex min-w-0 flex-1 items-start gap-1">
                {editing === key ? (
                  <>
                    <Input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void confirmEdit(key);
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="h-7 py-0 text-xs"
                      aria-label={`Valor de ${qualificationLabel(key)}`}
                    />
                    <button
                      onClick={() => void confirmEdit(key)}
                      aria-label="Guardar"
                      className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      aria-label="Cancelar"
                      className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setEditing(key);
                        setDraft(qualificationValueText(value));
                      }}
                      className="min-w-0 flex-1 break-words rounded px-1 py-1 text-left hover:bg-accent"
                      aria-label={`Editar ${qualificationLabel(key)}`}
                    >
                      {qualificationValueText(value)}
                    </button>
                    <span className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        onClick={() => setEditing(key)}
                        aria-label={`Editar ${qualificationLabel(key)}`}
                        className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        disabled={saving}
                        onClick={() => void save({ [key]: null })}
                        aria-label={`Quitar ${qualificationLabel(key)}`}
                        className="rounded p-1 text-text-3 hover:bg-accent hover:text-danger"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {adding && (
        <div className="mt-2 space-y-1.5">
          <Input
            autoFocus
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="Qué dato (ej. presupuesto)"
            className="h-7 py-0 text-xs"
            aria-label="Nombre del dato"
          />
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="Valor"
            className="h-7 py-0 text-xs"
            aria-label="Valor del dato"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={!newKey.trim() || !newValue.trim() || saving}
              onClick={() => void add()}
            >
              Agregar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setNewKey("");
                setNewValue("");
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
