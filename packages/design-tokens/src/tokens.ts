// Auto-generated from design/DESIGN.md — do not edit manually.

export const colors = {
  "surface": "#15121b",
  "surface-dim": "#15121b",
  "surface-bright": "#3c3741",
  "surface-container-lowest": "#100d15",
  "surface-container-low": "#1d1a23",
  "surface-container": "#221e27",
  "surface-container-high": "#2c2832",
  "surface-container-highest": "#37333d",
  "on-surface": "#e8e0ed",
  "on-surface-variant": "#ccc3d6",
  "inverse-surface": "#e8e0ed",
  "inverse-on-surface": "#332f38",
  "outline": "#968da0",
  "outline-variant": "#4a4454",
  "surface-tint": "#d4bbff",
  "primary": "#d4bbff",
  "on-primary": "#40008c",
  "primary-container": "#a675ff",
  "on-primary-container": "#38007c",
  "inverse-primary": "#7338d3",
  "secondary": "#c7c5d3",
  "on-secondary": "#302f3a",
  "secondary-container": "#484853",
  "on-secondary-container": "#b9b7c4",
  "tertiary": "#ffb94c",
  "on-tertiary": "#442b00",
  "tertiary-container": "#c28412",
  "on-tertiary-container": "#3c2500",
  "error": "#ffb4ab",
  "on-error": "#690005",
  "error-container": "#93000a",
  "on-error-container": "#ffdad6",
  "primary-fixed": "#ebdcff",
  "primary-fixed-dim": "#d4bbff",
  "on-primary-fixed": "#260059",
  "on-primary-fixed-variant": "#5b13bb",
  "secondary-fixed": "#e3e1ef",
  "secondary-fixed-dim": "#c7c5d3",
  "on-secondary-fixed": "#1b1b25",
  "on-secondary-fixed-variant": "#464651",
  "tertiary-fixed": "#ffddb2",
  "tertiary-fixed-dim": "#ffb94c",
  "on-tertiary-fixed": "#291800",
  "on-tertiary-fixed-variant": "#624000",
  "background": "#15121b",
  "on-background": "#e8e0ed",
  "surface-variant": "#37333d"
} as const;

export const typography = {
  "display": {
    fontFamily: "Outfit",
    fontSize: "48px",
    fontWeight: "700",
    lineHeight: "1.1",
    letterSpacing: "0"
  },
  "headline-lg": {
    fontFamily: "Outfit",
    fontSize: "32px",
    fontWeight: "600",
    lineHeight: "1.2",
    letterSpacing: "0"
  },
  "headline-md": {
    fontFamily: "Outfit",
    fontSize: "24px",
    fontWeight: "600",
    lineHeight: "1.3"
  },
  "body-lg": {
    fontFamily: "Outfit",
    fontSize: "18px",
    fontWeight: "400",
    lineHeight: "1.6"
  },
  "body-md": {
    fontFamily: "Outfit",
    fontSize: "16px",
    fontWeight: "400",
    lineHeight: "1.6"
  },
  "label-md": {
    fontFamily: "JetBrains Mono",
    fontSize: "14px",
    fontWeight: "500",
    lineHeight: "1.4"
  },
  "code-sm": {
    fontFamily: "JetBrains Mono",
    fontSize: "13px",
    fontWeight: "400",
    lineHeight: "1.5"
  },
  "headline-lg-mobile": {
    fontFamily: "Outfit",
    fontSize: "28px",
    fontWeight: "600",
    lineHeight: "1.2"
  }
} as const;

export const rounded = {
  "sm": "0.25rem",
  "DEFAULT": "0.5rem",
  "md": "0.75rem",
  "lg": "1rem",
  "xl": "1.5rem",
  "full": "9999px"
} as const;

export const spacing = {
  "unit": "4px",
  "xs": "4px",
  "sm": "8px",
  "md": "16px",
  "lg": "24px",
  "xl": "40px",
  "sidebar-width": "260px",
  "container-max": "1440px",
  "gutter": "24px"
} as const;

export type ColorKey = keyof typeof colors;
export type TypographyKey = keyof typeof typography;
export type RoundedKey = keyof typeof rounded;
export type SpacingKey = keyof typeof spacing;
