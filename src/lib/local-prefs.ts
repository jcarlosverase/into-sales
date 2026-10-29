/**
 * Preferencias de este navegador (`localStorage`): una comodidad, nunca un
 * requisito. Nada lanza: en modo privado o con el almacenamiento bloqueado se
 * lee null y no se guarda.
 *
 * Spec 1013: las claves llevaban el prefijo del nombre anterior. Si la nueva no existe y
 * la vieja sí, se copia a la nueva y se borra la vieja, para que nadie pierda
 * cómo dejó sus vistas al actualizar.
 */

export function readLocalPref(key: string, legacyKey?: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null || !legacyKey) return value;
    const legacy = window.localStorage.getItem(legacyKey);
    if (legacy !== null) {
      window.localStorage.setItem(key, legacy);
      window.localStorage.removeItem(legacyKey);
    }
    return legacy;
  } catch {
    return null;
  }
}

export function writeLocalPref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // la preferencia es una comodidad, no un requisito
  }
}
