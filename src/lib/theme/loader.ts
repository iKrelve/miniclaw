/**
 * Theme loader — loads and manages theme definitions.
 */

import type { ThemeDefinition } from './types';

// Import all theme JSON files statically (Vite handles JSON imports)
import defaultTheme from '../../../themes/default.json';
import nordTheme from '../../../themes/nord.json';
import tokyoNight from '../../../themes/tokyo-night.json';
import rosePine from '../../../themes/rose-pine.json';
import kanagawa from '../../../themes/kanagawa.json';
import everforest from '../../../themes/everforest.json';
import nightOwl from '../../../themes/night-owl.json';
import synthwave84 from '../../../themes/synthwave84.json';
import vesper from '../../../themes/vesper.json';
import poimandres from '../../../themes/poimandres.json';
import horizon from '../../../themes/horizon.json';
import github from '../../../themes/github.json';

const ALL_THEMES: ThemeDefinition[] = [
  defaultTheme,
  nordTheme,
  tokyoNight,
  rosePine,
  kanagawa,
  everforest,
  nightOwl,
  synthwave84,
  vesper,
  poimandres,
  horizon,
  github,
] as ThemeDefinition[];

// Sort by order
ALL_THEMES.sort((a, b) => a.order - b.order);

export function getThemes(): ThemeDefinition[] {
  return ALL_THEMES;
}

export function getTheme(id: string): ThemeDefinition | undefined {
  return ALL_THEMES.find((t) => t.id === id);
}

export function getDefaultTheme(): ThemeDefinition {
  return ALL_THEMES[0];
}
