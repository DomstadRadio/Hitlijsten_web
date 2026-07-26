/**
 * useTheme — vertaal een theme-object naar CSS custom properties.
 * Wordt door de publieke pagina's gebruikt om het thema van de lijst toe te passen.
 */
import { useEffect } from 'react';

const DEFAULTS = {
  primaryColor:   '#e00',
  secondaryColor: '#222',
  bgColor:        '#f5f5f5',
  textColor:      '#111',
  cardBg:         '#fff',
  fontFamily:     'sans-serif',
  borderRadius:   '12px',
};

export default function useTheme(theme) {
  useEffect(() => {
    const t = { ...DEFAULTS, ...theme };
    const root = document.documentElement;
    root.style.setProperty('--color-primary',   t.primaryColor);
    root.style.setProperty('--color-secondary', t.secondaryColor);
    root.style.setProperty('--color-bg',        t.bgColor);
    root.style.setProperty('--color-text',      t.textColor);
    root.style.setProperty('--color-card-bg',   t.cardBg);
    root.style.setProperty('--font-family',     t.fontFamily);
    root.style.setProperty('--border-radius',   t.borderRadius);

    if (t.bgImage) {
      document.body.style.backgroundImage = `url(${t.bgImage})`;
      document.body.style.backgroundSize  = 'cover';
      document.body.style.backgroundPosition = 'center';
    } else {
      document.body.style.backgroundImage = '';
      document.body.style.backgroundColor = t.bgColor;
    }

    return () => {
      document.body.style.backgroundImage = '';
    };
  }, [theme]);
}
