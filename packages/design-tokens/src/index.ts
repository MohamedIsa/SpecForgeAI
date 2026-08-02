export const color = {
  primary: "#2563EB",
  primaryHover: "#1D4ED8",
  primaryLight: "#DBEAFE",
  secondary: "#7C3AED",
  secondaryHover: "#6D28D9",
  secondaryLight: "#EDE9FE",
  background: "#FFFFFF",
  backgroundAlt: "#F8FAFC",
  surface: "#FFFFFF",
  surfaceRaised: "#F1F5F9",
  text: "#1E293B",
  textSecondary: "#64748B",
  textDisabled: "#94A3B8",
  textInverse: "#FFFFFF",
  border: "#E2E8F0",
  borderFocus: "#2563EB",
  error: "#DC2626",
  errorLight: "#FEE2E2",
  success: "#16A34A",
  successLight: "#DCFCE7",
  warning: "#F59E0B",
  warningLight: "#FEF3C7",
  modalBg: "#0d0d10",
  modalBorder: "#1c1c21",
  inputBg: "#131316",
  errorBorder: "#7f1d1d",
  columnBorder: "#18181c",
  priorityP0Bg: "#7f1d1d33",
  priorityP1Bg: "#78350f33",
  priorityP2Bg: "#1e3a5f33",
  priorityP3Bg: "#3b3b4233",
} as const;

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
  "2xl": "48px",
  "3xl": "64px",
} as const;

export const fontFamily = {
  sans: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  mono: "JetBrains Mono, Fira Code, monospace",
} as const;

export const fontSize = {
  xs: "12px",
  sm: "14px",
  base: "16px",
  lg: "18px",
  xl: "20px",
  "2xl": "24px",
  "3xl": "30px",
} as const;

export const fontWeight = {
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export const lineHeight = {
  tight: "1.25",
  base: "1.5",
  relaxed: "1.75",
} as const;

export const letterSpacing = {
  tight: "-0.025em",
  normal: "0",
  wide: "0.025em",
} as const;

export const borderRadius = {
  sm: "4px",
  md: "8px",
  lg: "12px",
  "2lg": "14px",
  xl: "16px",
  full: "9999px",
} as const;

export const borderWidth = {
  default: "1px",
  focus: "2px",
} as const;

export const boxShadow = {
  sm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
  xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
} as const;
