import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      toggle: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        set({ theme: next });
      },
    }),
    {
      name: 'abarrotes-theme',
      onRehydrateStorage: () => (state) => {
        applyTheme(state?.theme ?? 'light');
      },
    },
  ),
);

/** Tema claro/oscuro. El acento (indigo) vive en <html class="theme-accent-indigo">. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('theme-dark', theme === 'dark');
}
