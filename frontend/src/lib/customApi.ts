/**
 * Custom API helper that sends requests using the web SDK's apiCall.invoke.
 * This ensures proper routing through Lambda in production (published) environments.
 * Includes robust error handling to prevent white-page crashes.
 */

import { client } from '@/lib/api';

function getToken(): string | null {
  try {
    const customToken = localStorage.getItem('custom_token');
    if (customToken) return customToken;
    const platformToken = localStorage.getItem('token');
    if (platformToken) return platformToken;
  } catch {
    // localStorage might not be available
  }
  return null;
}

interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  ok: boolean;
}

/**
 * Detect if a string contains HTML content (e.g., a 503 error page).
 */
function isHtmlContent(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const trimmed = str.trim().toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.includes('<head>') ||
    trimmed.includes('<body>')
  );
}

/**
 * Extract a user-friendly error message from various error shapes.
 * Handles HTML 503 pages, JSON error responses, and plain strings.
 */
function extractErrorMessage(err: unknown): { message: string; status: number } {
  const error = err as {
    response?: { data?: unknown; status?: number };
    message?: string;
    status?: number;
  };

  const status = error?.response?.status || error?.status || 500;
  const responseData = error?.response?.data;

  // Handle HTML responses (e.g., 503 pages from proxy/gateway)
  if (typeof responseData === 'string' && isHtmlContent(responseData)) {
    if (status === 503) {
      return { message: 'الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً', status: 503 };
    }
    return { message: `خطأ في الخادم (${status})`, status };
  }

  // Handle JSON error responses with detail/message field
  if (responseData && typeof responseData === 'object') {
    const dataObj = responseData as { detail?: string; message?: string };

    // Check nested message field for DNS/infra errors (Lambda returns 500 with DNS text in message)
    const msgField = typeof dataObj.message === 'string' ? dataObj.message : '';
    if (msgField && hasDnsKeywords(msgField.toLowerCase())) {
      return { message: 'الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً', status: 503 };
    }

    const detail = dataObj.detail;
    if (detail && typeof detail === 'string') {
      if (isHtmlContent(detail)) {
        return { message: 'الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً', status };
      }
      if (hasDnsKeywords(detail.toLowerCase())) {
        return { message: 'الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً', status: 503 };
      }
      return { message: detail, status };
    }

    // Fall back to returning a clean message if available
    if (msgField) {
      return { message: msgField, status };
    }
  }

  // Handle error message string
  const rawMessage = error?.message || `API error: ${status}`;
  if (isHtmlContent(rawMessage)) {
    if (status === 503 || rawMessage.includes('503') || rawMessage.includes('Temporarily')) {
      return { message: 'الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً', status: 503 };
    }
    return { message: `خطأ في الخادم (${status})`, status };
  }

  // Check if the plain message hints at a 503 or transient infrastructure error
  const lowerRaw = rawMessage.toLowerCase();
  if (
    lowerRaw.includes('503') ||
    lowerRaw.includes('temporarily unavailable') ||
    lowerRaw.includes('dns') ||
    lowerRaw.includes('balancer') ||
    lowerRaw.includes('callback lock') ||
    lowerRaw.includes('econnrefused') ||
    lowerRaw.includes('etimedout') ||
    lowerRaw.includes('enotfound') ||
    lowerRaw.includes('network') ||
    lowerRaw.includes('timeout') ||
    lowerRaw.includes('lambda-url') ||
    lowerRaw.includes('node cache')
  ) {
    return { message: 'الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً', status: 503 };
  }

  return { message: rawMessage, status };
}

export class ApiError extends Error {
  status: number;
  isServiceUnavailable: boolean;
  /** Flag indicating this error originated from a DNS/infrastructure failure */
  isDnsInfra: boolean;

  constructor(message: string, status: number, isDnsInfra = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.isServiceUnavailable = status === 503;
    this.isDnsInfra = isDnsInfra;
  }
}

/**
 * Sanitize an error into a user-friendly Arabic message.
 * Use this everywhere before showing errors in toasts / UI.
 */
export function friendlyErrorMessage(err: unknown, fallback = 'حدث خطأ، يرجى المحاولة لاحقاً'): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();

  // Authentication / session expired → prompt user to log in again
  const status = err instanceof ApiError ? err.status : undefined;
  if (
    status === 401 || status === 403 ||
    lower.includes('يجب تسجيل الدخول') ||
    lower.includes('authentication credentials were not provided') ||
    lower.includes('token has expired') ||
    lower.includes('invalid authentication token') ||
    lower.includes('admin access required') ||
    lower.includes('unauthorized')
  ) {
    return 'انتهت جلستك، يرجى تسجيل الدخول مرة أخرى';
  }

  // DNS / infrastructure errors → generic "service unavailable"
  if (
    lower.includes('dns') || lower.includes('balancer') || lower.includes('callback lock') ||
    lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('etimedout') ||
    lower.includes('network') || lower.includes('timeout') || lower.includes('503') ||
    lower.includes('temporarily unavailable') || lower.includes('fetch failed') ||
    lower.includes('lambda-url') || lower.includes('node cache') || lower.includes('غير متاحة')
  ) {
    return 'الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً';
  }

  // HTML content in error message
  if (isHtmlContent(raw)) {
    return 'الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً';
  }

  // If the message looks like a clean Arabic string, use it
  if (raw && !lower.includes('error') && !lower.includes('failed to') && !lower.startsWith('{')) {
    return raw;
  }

  // ApiError with a clean message
  if (err instanceof ApiError && err.message && !isHtmlContent(err.message)) {
    return err.message;
  }

  return fallback;
}

/**
 * Check if an error is transient and worth retrying.
 */
function isTransientError(err: unknown): boolean {
  if (err instanceof ApiError) {
    if (err.isDnsInfra) return true;
    return err.status === 500 || err.status === 502 || err.status === 503 || err.status === 504 || err.status === 0;
  }
  const msg = String((err as { message?: string })?.message || '').toLowerCase();
  return (
    msg.includes('dns') ||
    msg.includes('balancer') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('network') ||
    msg.includes('callback lock') ||
    msg.includes('node cache') ||
    msg.includes('lambda-url') ||
    msg.includes('fetch') ||
    msg.includes('failed') ||
    msg.includes('غير متاحة')
  );
}

/**
 * Sleep helper for retry backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RETRIES = 12;
const BASE_DELAY_MS = 2500;
// Cap per-attempt delay so total retry window stays reasonable
// (~90-120s total for DNS errors, enough for Lambda cold-start + DNS propagation)
const MAX_DELAY_MS = 15000;

/**
 * Send a minimal error report to the backend error_logs endpoint.
 * Non-blocking, fails silently to avoid infinite loops when backend itself is down.
 * De-duplicates identical messages within a short window to prevent spam.
 */
const recentErrorSignatures = new Map<string, number>();
const ERROR_DEDUPE_WINDOW_MS = 30_000;

function shouldReportError(signature: string): boolean {
  const now = Date.now();
  // Clean up old entries
  for (const [key, ts] of recentErrorSignatures) {
    if (now - ts > ERROR_DEDUPE_WINDOW_MS) recentErrorSignatures.delete(key);
  }
  const last = recentErrorSignatures.get(signature);
  if (last && now - last < ERROR_DEDUPE_WINDOW_MS) return false;
  recentErrorSignatures.set(signature, now);
  return true;
}

async function reportErrorLog(payload: {
  error_type: string;
  status_code?: number;
  message: string;
  url?: string;
  method?: string;
  raw_details?: string;
}): Promise<void> {
  try {
    if (!client?.apiCall?.invoke) return;
    const signature = `${payload.error_type}|${payload.status_code || ''}|${payload.message}|${payload.url || ''}`;
    if (!shouldReportError(signature)) return;

    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Fire-and-forget; no retry on failure (to prevent loops)
    await client.apiCall.invoke({
      url: '/api/v1/error-logs/log',
      method: 'POST',
      data: {
        ...payload,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      },
      options: { headers },
    });
  } catch {
    // Silently ignore — logging errors must never cascade
  }
}

function classifyErrorType(err: unknown, status: number): string {
  if (isDnsOrInfraError(err)) return 'dns';
  if (status === 0) return 'network';
  if (status >= 500) return 'backend';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 400) return 'client';
  return 'unknown';
}

/**
 * Dispatch a global event so UI components (e.g., BackendStatus banner) can
 * react to backend connectivity changes without tight coupling.
 */
function dispatchBackendEvent(type: 'backend-error' | 'backend-ok'): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(type));
    }
  } catch {
    // ignore - this is only a UI hint
  }
}

/**
 * Detect DNS / infrastructure errors specifically (subset of transient).
 * Checks both the error message keywords AND the isDnsInfra flag on ApiError,
 * plus any nested response.data shape thrown by the SDK.
 */
function isDnsOrInfraError(err: unknown): boolean {
  // Check the flag first (handles re-thrown ApiErrors with friendly Arabic messages)
  if (err instanceof ApiError && err.isDnsInfra) return true;

  const errObj = err as { message?: string; response?: { data?: unknown }; data?: unknown };
  const msg = String(errObj?.message || '').toLowerCase();
  if (hasDnsKeywords(msg)) return true;

  // Check SDK-shaped errors: err.response.data.message or err.data.message
  if (errObj?.response?.data && responseHasDnsError(errObj.response.data)) return true;
  if (errObj?.data && responseHasDnsError(errObj.data)) return true;

  return false;
}

/**
 * Check if the raw API response body contains a DNS/infra error message
 * (Lambda returns 500 with the DNS error in the JSON body).
 * Checks multiple levels of nesting to handle various SDK response shapes.
 */
function responseHasDnsError(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;

  // Check direct message field
  const obj = data as Record<string, unknown>;
  const directMsg = String(obj?.message || '').toLowerCase();
  if (hasDnsKeywords(directMsg)) return true;

  // Check nested data.message (SDK may wrap: { data: { message: "..." }, status: 500 })
  if (obj?.data && typeof obj.data === 'object') {
    const nestedMsg = String((obj.data as Record<string, unknown>)?.message || '').toLowerCase();
    if (hasDnsKeywords(nestedMsg)) return true;
  }

  // Check detail field (FastAPI error shape)
  const detailMsg = String(obj?.detail || '').toLowerCase();
  if (hasDnsKeywords(detailMsg)) return true;

  // Check error field
  const errorMsg = String(obj?.error || '').toLowerCase();
  if (hasDnsKeywords(errorMsg)) return true;

  return false;
}

function hasDnsKeywords(msg: string): boolean {
  return (
    msg.includes('dns') || msg.includes('balancer') || msg.includes('callback lock') ||
    msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('lambda-url') ||
    msg.includes('node cache') || msg.includes('etimedout') ||
    (msg.includes('failed') && msg.includes('resolve'))
  );
}

/**
 * When VITE_API_URL is set (external hosting), use direct fetch instead of SDK.
 */
const EXTERNAL_API_URL = import.meta.env.VITE_API_URL || '';

async function directFetch<T>(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<{ data: T; status: number }> {
  const fullUrl = `${EXTERNAL_API_URL}${url}`;
  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  const res = await fetch(fullUrl, {
    method,
    headers: fetchHeaders,
    body: method !== 'GET' && body ? JSON.stringify(body) : undefined,
  });

  let data: T;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = (await res.text()) as unknown as T;
  }

  if (!res.ok) {
    const msg = typeof data === 'object' && data !== null && 'detail' in data
      ? String((data as Record<string, unknown>).detail)
      : `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }

  return { data, status: res.status };
}

export async function customApi<T = unknown>(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<ApiResponse<T>> {
  const token = getToken();

  // Build extra headers
  const extraHeaders: Record<string, string> = {};
  if (token) {
    extraHeaders['Authorization'] = `Bearer ${token}`;
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // If VITE_API_URL is set, use direct fetch (external hosting mode)
      if (EXTERNAL_API_URL) {
        const response = await directFetch<T>(url, method, body, extraHeaders);
        dispatchBackendEvent('backend-ok');
        return {
          data: response.data,
          status: response.status,
          ok: true,
        };
      }

      // Verify SDK client is available
      if (!client?.apiCall?.invoke) {
        throw new ApiError('SDK client not initialized', 0);
      }

      // Use web SDK's apiCall.invoke for proper Lambda routing in production
      const response = await client.apiCall.invoke({
        url,
        method,
        data: body || (method === 'GET' ? {} : undefined),
        options: {
          headers: extraHeaders,
        },
      });

      // Check if the response data itself is an HTML error page
      if (typeof response?.data === 'string' && isHtmlContent(response.data)) {
        const status = response?.status || 503;
        throw new ApiError(
          'الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً',
          status
        );
      }

      // Check if the response body contains a DNS/infra error (Lambda 500 with DNS message)
      if (response?.data && responseHasDnsError(response.data)) {
        throw new ApiError(
          'الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً',
          503,
          true // Mark as DNS/infra error so retry logic recognizes it
        );
      }

      // Check if the entire response object itself is a DNS error wrapper
      // (some SDK versions return the whole error as the response)
      if (response && responseHasDnsError(response)) {
        throw new ApiError(
          'الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً',
          503,
          true
        );
      }

      // Deep check: SDK may nest as { url, data: { message: "dns..." }, status: 500 }
      const respAny = response as Record<string, unknown> | undefined;
      if (respAny?.url && respAny?.data && typeof respAny.data === 'object') {
        const innerData = respAny.data as Record<string, unknown>;
        const innerMsg = String(innerData?.message || '').toLowerCase();
        if (hasDnsKeywords(innerMsg)) {
          throw new ApiError(
            'الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً',
            503,
            true
          );
        }
      }

      // If status is 500+ and there's no meaningful data, treat as server error
      const httpStatus = response?.status || 200;
      if (httpStatus >= 500) {
        throw new ApiError(
          'الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً',
          httpStatus
        );
      }

      // Success: signal backend is reachable
      dispatchBackendEvent('backend-ok');

      return {
        data: response?.data as T,
        status: httpStatus,
        ok: true,
      };
    } catch (err: unknown) {
      lastError = err;

      // Signal backend connectivity issues to UI for DNS/infra errors
      if (isDnsOrInfraError(err)) {
        dispatchBackendEvent('backend-error');
      }

      // Report error to backend logging (only on final attempt to avoid spam)
      if (attempt >= MAX_RETRIES - 1 || !isTransientError(err)) {
        const e = err as { message?: string; status?: number; response?: { status?: number } };
        const status = (err instanceof ApiError ? err.status : (e?.status || e?.response?.status || 0));
        const errType = classifyErrorType(err, status);
        // Don't log routine 401/403 auth errors — they're expected
        // Also skip logging DNS errors for high-frequency polling endpoints to avoid log spam
        const isPollingEndpoint = url.includes('/unread-count') || url.includes('/ws-notifications');
        const skipLog = (errType === 'auth' || errType === 'client') || (errType === 'dns' && isPollingEndpoint);
        if (!skipLog) {
          const rawMessage = err instanceof Error ? err.message : String(err || 'Unknown error');
          void reportErrorLog({
            error_type: errType,
            status_code: status || undefined,
            message: rawMessage.slice(0, 1000),
            url,
            method,
            raw_details: JSON.stringify({
              attempt,
              isDnsInfra: err instanceof ApiError ? err.isDnsInfra : undefined,
              time: new Date().toISOString(),
            }).slice(0, 2000),
          });
        }
      }

      // Decide whether to retry
      if (attempt < MAX_RETRIES) {
        const canRetry = isDnsOrInfraError(err)
          ? true  // DNS/infra: retry ALL methods
          : isTransientError(err) && method === 'GET'; // Other transient: GET only

        if (canRetry) {
          // Use longer delays for DNS errors (they need time for Lambda warm-up & DNS propagation)
          const delayMultiplier = isDnsOrInfraError(err) ? 1.5 : 1;
          // DNS errors on first attempts get a longer initial wait to let infra stabilize
          const baseDelay = isDnsOrInfraError(err) && attempt <= 1 ? 5000 : BASE_DELAY_MS;
          // Exponential backoff capped at MAX_DELAY_MS to avoid very long waits
          const delay = Math.min(baseDelay * Math.pow(1.5, attempt) * delayMultiplier, MAX_DELAY_MS);
          await sleep(delay);
          continue;
        }
      }

      // Ensure DNS/infra errors always have a friendly message
      if (isDnsOrInfraError(err)) {
        throw new ApiError('الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً', 503, true);
      }

      // Re-throw ApiError as-is
      if (err instanceof ApiError) {
        throw err;
      }

      // Extract a clean, user-friendly error message
      const { message, status } = extractErrorMessage(err);
      throw new ApiError(message, status);
    }
  }

  // All retries exhausted – always return a friendly message for DNS errors
  if (isDnsOrInfraError(lastError)) {
    throw new ApiError('الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً', 503, true);
  }
  const { message, status } = extractErrorMessage(lastError);
  throw new ApiError(message, status);
}