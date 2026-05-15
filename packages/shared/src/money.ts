/**
 * Helpers de dinero basados en enteros (centavos) para evitar errores de
 * coma flotante. En tránsito (API/DB payloads) el dinero viaja como `number`
 * de centavos; se formatea a moneda solo en la capa de presentación.
 */

export type Cents = number;

/** Convierte un monto en unidades mayores (p.ej. pesos) a centavos enteros. */
export function toCents(amount: number): Cents {
  return Math.round(amount * 100);
}

/** Convierte centavos a unidades mayores (float con 2 decimales). */
export function fromCents(cents: Cents): number {
  return Math.round(cents) / 100;
}

/** Suma una lista de centavos de forma segura. */
export function sumCents(values: Cents[]): Cents {
  return values.reduce((acc, v) => acc + Math.round(v), 0);
}

/**
 * Aplica un porcentaje (0-100) a un monto en centavos, redondeando al centavo.
 */
export function pctOf(cents: Cents, percent: number): Cents {
  return Math.round((cents * percent) / 100);
}

/** Formatea centavos como string de moneda local. */
export function formatMoney(
  cents: Cents,
  currency = 'MXN',
  locale = 'es-MX',
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    fromCents(cents),
  );
}

/** Calcula el total de una línea: (precio - descuento) * cantidad, en centavos. */
export function lineTotalCents(
  unitPriceCents: Cents,
  quantity: number,
  discountCents: Cents = 0,
): Cents {
  return Math.round((unitPriceCents - discountCents) * quantity);
}
