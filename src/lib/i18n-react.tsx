import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import {
  detectSystemLanguage, LANGUAGE_STORAGE_KEY, readLanguageChoice, resolveLanguage,
  translateTemplate, type Language, type LanguageChoice,
} from './i18n';

interface LanguageContextValue {
  language: Language;
  choice: LanguageChoice;
  setChoice(value: LanguageChoice): void;
  t(text: string, values?: Record<string, string | number>): string;
}
const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: PropsWithChildren) {
  // Initialize synchronously: no first-render flash of the wrong language.
  const [choice, setChoiceState] = useState<LanguageChoice>(() => {
    try { return readLanguageChoice(window.localStorage); }
    catch { return 'system'; }
  });
  const [system, setSystem] = useState<Language>(() => detectSystemLanguage(navigator));
  const language = resolveLanguage(choice, system);
  const setChoice = useCallback((value: LanguageChoice) => {
    // Persist only this front-end preference; no Tauri save/restart IPC.
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, value); } catch { /* restricted storage */ }
    setChoiceState(value);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    const sync = () => setSystem(detectSystemLanguage(navigator));
    window.addEventListener('languagechange', sync);
    return () => window.removeEventListener('languagechange', sync);
  }, []);
  const t = useCallback((text: string, values?: Record<string, string | number>) =>
    translateTemplate(text, language, values), [language]);
  const value = useMemo(() => ({ language, choice, setChoice, t }), [language, choice, setChoice, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useI18n must be inside LanguageProvider');
  return value;
}
