import { useFooterText } from '@/lib/useFooterText';

/**
 * Global site footer shown at the bottom of every page.
 * Text content is fetched from the backend (admin-editable);
 * the current year is always appended automatically.
 */
export default function Footer() {
  const { text } = useFooterText();
  const year = new Date().getFullYear();

  return (
    <footer
      dir="rtl"
      className="mt-auto w-full border-t border-slate-700/40 bg-slate-800 text-slate-100"
    >
      <div className="mx-auto max-w-7xl px-4 py-4 text-center">
        <p className="text-xs sm:text-sm font-light tracking-wide">
          {text} - {year}
        </p>
      </div>
    </footer>
  );
}