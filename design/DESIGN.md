---
name: Specforge Glass
colors:
  surface: '#15121b'
  surface-dim: '#15121b'
  surface-bright: '#3c3741'
  surface-container-lowest: '#100d15'
  surface-container-low: '#1d1a23'
  surface-container: '#221e27'
  surface-container-high: '#2c2832'
  surface-container-highest: '#37333d'
  on-surface: '#e8e0ed'
  on-surface-variant: '#ccc3d6'
  inverse-surface: '#e8e0ed'
  inverse-on-surface: '#332f38'
  outline: '#968da0'
  outline-variant: '#4a4454'
  surface-tint: '#d4bbff'
  primary: '#d4bbff'
  on-primary: '#40008c'
  primary-container: '#a675ff'
  on-primary-container: '#38007c'
  inverse-primary: '#7338d3'
  secondary: '#c7c5d3'
  on-secondary: '#302f3a'
  secondary-container: '#484853'
  on-secondary-container: '#b9b7c4'
  tertiary: '#ffb94c'
  on-tertiary: '#442b00'
  tertiary-container: '#c28412'
  on-tertiary-container: '#3c2500'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ebdcff'
  primary-fixed-dim: '#d4bbff'
  on-primary-fixed: '#260059'
  on-primary-fixed-variant: '#5b13bb'
  secondary-fixed: '#e3e1ef'
  secondary-fixed-dim: '#c7c5d3'
  on-secondary-fixed: '#1b1b25'
  on-secondary-fixed-variant: '#464651'
  tertiary-fixed: '#ffddb2'
  tertiary-fixed-dim: '#ffb94c'
  on-tertiary-fixed: '#291800'
  on-tertiary-fixed-variant: '#624000'
  background: '#15121b'
  on-background: '#e8e0ed'
  surface-variant: '#37333d'
typography:
  display:
    fontFamily: Outfit
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Outfit
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Outfit
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Outfit
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Outfit
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
  headline-lg-mobile:
    fontFamily: Outfit
    fontSize: 28px
    fontWeight: '600'
    lineHeight: '1.2'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  sidebar-width: 260px
  container-max: 1440px
  gutter: 24px
---

## Brand & Style
The design system is engineered for high-performance developer tools and AI engineering environments. It prioritizes a "Deep Space" aesthetic, utilizing a dark-mode-first philosophy to reduce eye strain during long technical sessions. 

The visual style is a refined **Glassmorphism**, characterized by translucent surfaces, subtle backdrop blurs, and high-precision borders. It aims to evoke an emotional response of focus, technological sophistication, and fluid intelligence. The interface should feel like a premium command center—tactile yet ethereal, with vibrant accents cutting through a disciplined, dark canvas.

## Colors
This design system utilizes a high-depth palette anchored in ultra-dark neutrals. 

- **Core Neutrals:** The base background is nearly black, providing maximum contrast for glass surfaces. Surfaces use a semi-transparent navy-grey to simulate depth.
- **Accents:** The Primary Accent (Purple) is reserved for high-intent actions and active states, often accompanied by a soft glow or outer shadow to simulate luminescence.
- **Functional Colors:** Success, Warning, and Danger colors are highly saturated to ensure immediate recognition against the dark backdrop.
- **Glass Effects:** Transparency is key. All panel backgrounds must use the surface color with a `backdrop-filter: blur(16px)` to maintain legibility over moving or complex backgrounds.

## Typography
The typography strategy pairs the geometric clarity of **Outfit** with the technical precision of **JetBrains Mono**. 

- **Headings & Body:** Use Outfit for all natural language. Headings should be near-white (`#FAFAFA`) with tight letter spacing for a modern, compact look. Body text uses a muted silver-grey to establish clear hierarchy.
- **Data & Code:** JetBrains Mono is the dedicated font for all technical data, code snippets, and UI labels. This creates a "workspace" feel where functional data is visually distinct from descriptive content.
- **Scaling:** For mobile, reduce display and large headline sizes by 15-20% to prevent excessive line-wrapping while maintaining the bold weight.

## Layout & Spacing
The layout follows a **Fluid Grid** model with a specific focus on dashboard-style navigation.

- **Sidebar:** A fixed-width left sidebar (260px) serves as the primary navigation anchor. It should use a darker, less transparent surface than the main content area to ground the UI.
- **Main Canvas:** Content area utilizes a 12-column grid on desktop. Large panels and cards should span 4, 6, or 12 columns.
- **Rhythm:** An 8px base grid (starting from a 4px unit) ensures consistent vertical rhythm. Use `24px` (lg) for standard container padding and `16px` (md) for internal element spacing.
- **Breakpoints:**
  - Mobile (< 768px): Single column, hidden sidebar (drawer), 16px margins.
  - Tablet (768px - 1024px): 8-column grid, collapsed sidebar (icons only).
  - Desktop (> 1024px): 12-column grid, full sidebar.

## Elevation & Depth
Depth is created through **Glassmorphism** and light-tinted outlines rather than heavy black shadows.

- **Layering:** 
  - Level 0: Base background (Solid).
  - Level 1: Sidebar and background accents (Flat).
  - Level 2: Main Cards/Panels (Glass + 1px border).
  - Level 3: Modals and Popovers (Glass + 1px border + subtle purple glow shadow).
- **Borders:** All glass elements must have a `1px` solid border using `rgba(255, 255, 255, 0.08)`. This acts as a "specular highlight" that defines the edge of the glass.
- **Shadows:** Avoid traditional drop shadows. Instead, use a very soft, large-radius `box-shadow` with the primary accent color at low opacity (e.g., `0 10px 40px rgba(157, 102, 255, 0.15)`) for elevated active elements.

## Shapes
The shape language is "Softly Technical." 

A `0.5rem` (8px) base radius provides a modern, approachable feel while maintaining the structural integrity of a grid-based tool. 
- **Standard Cards/Buttons:** Use `rounded` (8px).
- **Interactive Inputs:** Use `rounded` (8px).
- **Floating Action Buttons/Tags:** Use `rounded-xl` (24px) or pill shapes for high contrast against the angular grid.
- **Inner Elements:** When nesting elements (like a button inside a card), the inner radius should be half the outer radius (4px) to maintain visual harmony.

## Components
- **Buttons:**
  - *Primary:* Solid Primary Accent color with white text. High-intent buttons should have a subtle outer glow.
  - *Ghost:* No background, 1px border of `rgba(255, 255, 255, 0.1)`, text in Secondary Text color. Hover state turns border to Primary Accent.
- **Input Fields:** Darker than the panel background (`rgba(0,0,0,0.2)`) with a 1px bottom border or full outline. Active state uses a Primary Accent border.
- **Cards/Panels:** The signature glass component. Use the defined surface color, blur, and border. Header areas within cards should be separated by a `1px` divider.
- **Chips/Labels:** Use JetBrains Mono. Small, low-saturation backgrounds with high-contrast text. For status chips (e.g., "Active"), use a small glowing dot icon.
- **Navigation:** Sidebar items use a "thick vertical bar" on the left side to indicate the active state, colored in the Primary Accent purple.
- **Code Blocks:** Use a deep black background (`#000000`) inside a glass panel to provide maximum syntax highlighting contrast.