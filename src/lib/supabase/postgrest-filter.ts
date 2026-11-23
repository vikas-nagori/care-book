/**
 * Quote a value for a PostgREST `.or()` / filter-string expression. Unquoted, a value containing
 * `,` `(` `)` or `.` can split or extend the filter; inside double quotes only `"` and `\` need
 * escaping.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
