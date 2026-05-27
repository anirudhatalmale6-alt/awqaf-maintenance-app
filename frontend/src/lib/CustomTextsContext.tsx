import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { customApi } from '@/lib/customApi';
import { useAuth } from '@/lib/AuthContext';

interface CustomTextsContextType {
  /** Get custom text by key, falling back to defaultValue if not set */
  getText: (key: string, defaultValue: string) => string;
  /** Save a custom text (owner only) */
  setText: (key: string, value: string) => Promise<void>;
  /** Delete a custom text to revert to default (owner only) */
  deleteText: (key: string) => Promise<void>;
  /** Whether the current user is the owner and can edit texts */
  isOwner: boolean;
  /** Whether texts are still loading */
  loading: boolean;
}

const CustomTextsContext = createContext<CustomTextsContextType>({
  getText: (_key: string, defaultValue: string) => defaultValue,
  setText: async () => {},
  deleteText: async () => {},
  isOwner: false,
  loading: true,
});

export function CustomTextsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const isOwner = user?.role === 'owner';

  // Fetch all custom texts on mount
  useEffect(() => {
    const fetchTexts = async () => {
      try {
        const res = await customApi<{ texts: Record<string, string> }>('/api/v1/custom-texts/all', 'GET');
        if (res.data?.texts) {
          setTexts(res.data.texts);
        }
      } catch {
        // Silently fail - texts will use defaults
      } finally {
        setLoading(false);
      }
    };
    fetchTexts();
  }, []);

  const getText = useCallback(
    (key: string, defaultValue: string): string => {
      return texts[key] ?? defaultValue;
    },
    [texts]
  );

  const setText = useCallback(
    async (key: string, value: string) => {
      if (!isOwner) return;
      try {
        await customApi('/api/v1/custom-texts/upsert', 'POST', {
          text_key: key,
          text_value: value,
        });
        setTexts((prev) => ({ ...prev, [key]: value }));
      } catch (err) {
        console.error('Failed to save custom text:', err);
        throw err;
      }
    },
    [isOwner]
  );

  const deleteText = useCallback(
    async (key: string) => {
      if (!isOwner) return;
      try {
        await customApi(`/api/v1/custom-texts/delete/${encodeURIComponent(key)}`, 'DELETE');
        setTexts((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      } catch (err) {
        console.error('Failed to delete custom text:', err);
        throw err;
      }
    },
    [isOwner]
  );

  return (
    <CustomTextsContext.Provider value={{ getText, setText, deleteText, isOwner, loading }}>
      {children}
    </CustomTextsContext.Provider>
  );
}

export function useCustomTexts() {
  return useContext(CustomTextsContext);
}