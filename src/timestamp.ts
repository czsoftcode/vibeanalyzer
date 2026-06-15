/**
 * Časové razítko bezpečné pro názvy souborů: ISO čas, kde se ":" a "."
 * (na některých systémech problematické) nahradí "-".
 * Příklad: 2026-06-15T18-40-40-236Z
 */
export function fileTimestamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}
