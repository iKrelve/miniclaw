/**
 * Theme type definitions.
 */

export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
  [key: string]: string;
}

export interface ThemeDefinition {
  id: string;
  label: string;
  order: number;
  description: string;
  codeTheme: { light: string; dark: string };
  shikiTheme: { light: string; dark: string };
  light: ThemeColors;
  dark: ThemeColors;
}
