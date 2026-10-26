export function sanitizeProductHint(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;

  const cleaned = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, 120);

  return cleaned || undefined;
}
