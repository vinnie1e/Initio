import { argbFromHex, hexFromArgb, themeFromSourceColor } from "@material/material-color-utilities";

export function getM3Palette(seedHex: string, isDark: boolean) {
  try {
    // 1. Parse seed color hex to ARGB integer
    const argb = argbFromHex(seedHex);
    
    // 2. Generate the M3 dynamic theme
    const theme = themeFromSourceColor(argb);
    
    // 3. Extract the correct scheme (light or dark)
    const scheme = isDark ? theme.schemes.dark : theme.schemes.light;
    const palettes = theme.palettes;
    
    const getHex = (argbValue: number) => hexFromArgb(argbValue);
    
    return {
      primary: getHex(scheme.primary),
      onPrimary: getHex(scheme.onPrimary),
      primaryContainer: getHex(scheme.primaryContainer),
      onPrimaryContainer: getHex(scheme.onPrimaryContainer),
      
      secondary: getHex(scheme.secondary),
      onSecondary: getHex(scheme.onSecondary),
      secondaryContainer: getHex(scheme.secondaryContainer),
      onSecondaryContainer: getHex(scheme.onSecondaryContainer),
      
      tertiary: getHex(scheme.tertiary),
      onTertiary: getHex(scheme.onTertiary),
      tertiaryContainer: getHex(scheme.tertiaryContainer),
      onTertiaryContainer: getHex(scheme.onTertiaryContainer),
      
      background: getHex(scheme.background),
      onBackground: getHex(scheme.onBackground),
      
      surface: getHex(scheme.surface),
      onSurface: getHex(scheme.onSurface),
      surfaceVariant: getHex(scheme.surfaceVariant),
      onSurfaceVariant: getHex(scheme.onSurfaceVariant),
      
      outline: getHex(scheme.outline),
      outlineVariant: getHex(scheme.outlineVariant),
      
      error: getHex(scheme.error),
      onError: getHex(scheme.onError),
      errorContainer: getHex(scheme.errorContainer),
      onErrorContainer: getHex(scheme.onErrorContainer),
      
      // Surface Container Roles (M3 elevation without shadows)
      surfaceContainerLowest: getHex(palettes.neutral.tone(isDark ? 4 : 100)),
      surfaceContainerLow: getHex(palettes.neutral.tone(isDark ? 10 : 96)),
      surfaceContainer: getHex(palettes.neutral.tone(isDark ? 12 : 94)),
      surfaceContainerHigh: getHex(palettes.neutral.tone(isDark ? 17 : 92)),
      surfaceContainerHighest: getHex(palettes.neutral.tone(isDark ? 22 : 90)),
    };
  } catch (e) {
    console.error("Error generating M3 dynamic palette:", e);
    // Return a safe fallback
    return {
      primary: seedHex,
      onPrimary: "#ffffff",
      primaryContainer: seedHex + "33",
      onPrimaryContainer: seedHex,
      secondary: "#9a9a9a",
      onSecondary: "#ffffff",
      secondaryContainer: "#efefef",
      onSecondaryContainer: "#1c1c1c",
      tertiary: "#5eead4",
      onTertiary: "#1c1c1c",
      tertiaryContainer: "#5eead433",
      onTertiaryContainer: "#5eead4",
      background: isDark ? "#0e1117" : "#ffffff",
      onBackground: isDark ? "#f3efe7" : "#1a1a18",
      surface: isDark ? "#12141b" : "#f6f5f1",
      onSurface: isDark ? "#f3efe7" : "#1a1a18",
      surfaceVariant: isDark ? "#171a22" : "#efeee9",
      onSurfaceVariant: isDark ? "#9aa0ad" : "#5f5e58",
      outline: isDark ? "#6a7080" : "#e0ded7",
      outlineVariant: isDark ? "#171a22" : "#efeee9",
      error: "#ff6b6b",
      onError: "#ffffff",
      errorContainer: "#ff6b6b33",
      onErrorContainer: "#ff6b6b",
      surfaceContainerLowest: isDark ? "#0a0c10" : "#ffffff",
      surfaceContainerLow: isDark ? "#0e1117" : "#faf5ea",
      surfaceContainer: isDark ? "#12141b" : "#efeee9",
      surfaceContainerHigh: isDark ? "#171a22" : "#efe6d6",
      surfaceContainerHighest: isDark ? "#21252e" : "#e4d9c4"
    };
  }
}

export function applyM3PaletteToStyle(seedHex: string, isDark: boolean) {
  const root = document.documentElement.style;
  const colors = getM3Palette(seedHex, isDark);

  // Set M3 System properties (Dynamic Color)
  root.setProperty("--md-sys-color-primary", colors.primary);
  root.setProperty("--md-sys-color-on-primary", colors.onPrimary);
  root.setProperty("--md-sys-color-primary-container", colors.primaryContainer);
  root.setProperty("--md-sys-color-on-primary-container", colors.onPrimaryContainer);
  
  root.setProperty("--md-sys-color-secondary", colors.secondary);
  root.setProperty("--md-sys-color-on-secondary", colors.onSecondary);
  root.setProperty("--md-sys-color-secondary-container", colors.secondaryContainer);
  root.setProperty("--md-sys-color-on-secondary-container", colors.onSecondaryContainer);
  
  root.setProperty("--md-sys-color-tertiary", colors.tertiary);
  root.setProperty("--md-sys-color-on-tertiary", colors.onTertiary);
  root.setProperty("--md-sys-color-tertiary-container", colors.tertiaryContainer);
  root.setProperty("--md-sys-color-on-tertiary-container", colors.onTertiaryContainer);
  
  root.setProperty("--md-sys-color-background", colors.background);
  root.setProperty("--md-sys-color-on-background", colors.onBackground);
  
  root.setProperty("--md-sys-color-surface", colors.surface);
  root.setProperty("--md-sys-color-on-surface", colors.onSurface);
  root.setProperty("--md-sys-color-surface-variant", colors.surfaceVariant);
  root.setProperty("--md-sys-color-on-surface-variant", colors.onSurfaceVariant);
  
  root.setProperty("--md-sys-color-outline", colors.outline);
  root.setProperty("--md-sys-color-outline-variant", colors.outlineVariant);
  
  root.setProperty("--md-sys-color-error", colors.error);
  root.setProperty("--md-sys-color-on-error", colors.onError);
  root.setProperty("--md-sys-color-error-container", colors.errorContainer);
  root.setProperty("--md-sys-color-on-error-container", colors.onErrorContainer);
  
  root.setProperty("--md-sys-color-surface-container-lowest", colors.surfaceContainerLowest);
  root.setProperty("--md-sys-color-surface-container-low", colors.surfaceContainerLow);
  root.setProperty("--md-sys-color-surface-container", colors.surfaceContainer);
  root.setProperty("--md-sys-color-surface-container-high", colors.surfaceContainerHigh);
  root.setProperty("--md-sys-color-surface-container-highest", colors.surfaceContainerHighest);

  // Bind legacy variables to the new dynamic colors so the entire app restyles beautifully and instantly
  root.setProperty("--ink", colors.background);
  root.setProperty("--ink-2", colors.surfaceContainerLow);
  root.setProperty("--surface", colors.surfaceContainer);
  root.setProperty("--surface-2", colors.surfaceContainerHigh);
  root.setProperty("--line", colors.outlineVariant);
  root.setProperty("--line-soft", colors.surfaceContainerLow);
  
  root.setProperty("--ember", colors.primary);
  root.setProperty("--ember-deep", colors.primaryContainer);
  root.setProperty("--flow", colors.tertiary);
  root.setProperty("--gold", colors.secondary);
  root.setProperty("--violet", colors.primary);
  root.setProperty("--text", colors.onBackground);
  root.setProperty("--muted", colors.onSurfaceVariant);
  root.setProperty("--muted-2", colors.outline);
  root.setProperty("--good", colors.tertiary); // Use tertiary for good to avoid red/green conflicts but fit Material You scheme
  root.setProperty("--warn", colors.secondary);
  root.setProperty("--bad", colors.error);
  root.setProperty("--bg", colors.background);
  root.setProperty("--card-bg", colors.surfaceContainer);
  root.setProperty("--card-border", colors.outlineVariant);
  root.setProperty("--on-accent", colors.onPrimary);
  root.setProperty("--btn-bg", colors.primary);
  root.setProperty("--btn-fg", colors.onPrimary);
  root.setProperty("--btn-border", "transparent");

  // Hero section overrides
  root.setProperty("--hero-bg", colors.surfaceContainerHigh);
  root.setProperty("--hero-text", colors.onSurface);
  root.setProperty("--hero-muted", colors.onSurfaceVariant);
  root.setProperty("--hero-line", colors.outlineVariant);
  root.setProperty("--hero-pill-bg", colors.surfaceContainerHighest);
  root.setProperty("--hero-pill-border", colors.outline);
}
