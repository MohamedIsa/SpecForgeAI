export function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  const last = parts.at(-1);
  if (!last || last === first) return first.slice(0, 2).toUpperCase();
  return `${first[0]}${last[0]}`.toUpperCase();
}
