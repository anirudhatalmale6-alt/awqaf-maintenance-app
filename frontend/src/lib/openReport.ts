/**
 * Navigation helpers for opening reports with new-tab support.
 *
 * Supports:
 * - Ctrl/Cmd/Shift + Click → open in new tab
 * - Middle mouse button (auxClick) → open in new tab
 * - Normal click → in-app navigation via react-router
 */

import type { NavigateFunction } from 'react-router-dom';
import type { MouseEvent } from 'react';

/**
 * Handle a primary click on a report row/card. Respects modifier keys to open
 * in a new tab when the user presses Ctrl/Cmd/Shift.
 *
 * @param e - The React mouse event.
 * @param reportId - The numeric ID of the report.
 * @param navigate - react-router navigate function for in-app navigation.
 * @param onNavigate - Optional callback executed BEFORE same-tab navigation
 *                    (useful for closing panels, toggling select mode, etc.).
 *                    NOT called when opening in a new tab.
 */
export function openReportClick(
  e: MouseEvent,
  reportId: number,
  navigate: NavigateFunction,
  onNavigate?: () => void,
): void {
  const url = `/report/${reportId}`;
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    e.preventDefault();
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (onNavigate) onNavigate();
  navigate(url);
}

/**
 * Handle middle-click (button === 1) on a report row/card.
 * Opens the report in a new tab.
 */
export function openReportAuxClick(e: MouseEvent, reportId: number): void {
  if (e.button === 1) {
    e.preventDefault();
    window.open(`/report/${reportId}`, '_blank', 'noopener,noreferrer');
  }
}