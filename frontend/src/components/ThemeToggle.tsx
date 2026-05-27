/**
 * Theme toggle component with three modes: Light, Dark, System.
 * Shows a dropdown menu for selection with current mode indicator.
 */

import { Moon, Sun, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme, type Theme } from '@/lib/ThemeContext';

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'وضع النهار', icon: Sun },
  { value: 'dark', label: 'الوضع الليلي', icon: Moon },
  { value: 'system', label: 'حسب توقيت الكويت', icon: Monitor },
];

export default function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={resolvedTheme === 'dark' ? 'الوضع الليلي' : 'وضع النهار'}
          className="relative"
        >
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-gray-600 dark:text-gray-400" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-gray-600 dark:text-gray-400" />
          <span className="sr-only">تبديل المظهر</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isActive = theme === option.value;
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => setTheme(option.value)}
              className={`flex items-center gap-2 cursor-pointer ${isActive ? 'bg-accent font-medium' : ''}`}
            >
              <Icon className="h-4 w-4" />
              <span>{option.label}</span>
              {isActive && (
                <span className="mr-auto text-xs text-blue-600 dark:text-blue-400">✓</span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}