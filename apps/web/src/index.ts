import { colors, spacing } from "@specforge/design-tokens";
import "@specforge/design-tokens/tokens.css";

export const APP_TITLE = "BRD Tech Stack & Ticket Extractor";

export function getAppTitle(): string {
  return APP_TITLE;
}

export const theme = {
  primary: colors.primary,
  background: colors.background,
  surface: colors.surface,
  textPrimary: colors["on-surface"],
  textSecondary: colors["on-surface-variant"],
  spacing: spacing.md,
} as const;
