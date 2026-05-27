// Runtime configuration
// Note: Since all API calls now use the web SDK's client.apiCall.invoke,
// which handles routing automatically, no runtime config endpoint is needed.

let runtimeConfig: {
  API_BASE_URL: string;
} | null = null;

// Configuration loading state
let configLoading = false; // No async loading needed

// Default fallback configuration
const defaultConfig = {
  API_BASE_URL: '', // Empty string - web SDK handles routing in production
};

// Function to load runtime configuration
// No-op since web SDK handles API routing automatically
export async function loadRuntimeConfig(): Promise<void> {
  // In production, the web SDK's client.apiCall.invoke handles all routing.
  // In development, Vite proxy handles routing via VITE_API_BASE_URL.
  // No need to fetch from a /api/config endpoint.
  if (import.meta.env.VITE_API_BASE_URL) {
    runtimeConfig = {
      API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    };
  }
  configLoading = false;
}

// Get current configuration
export function getConfig() {
  if (runtimeConfig) {
    return runtimeConfig;
  }

  // Try Vite environment variables (for local development)
  if (import.meta.env.VITE_API_BASE_URL) {
    return {
      API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    };
  }

  return defaultConfig;
}

// Dynamic API_BASE_URL getter
export function getAPIBaseURL(): string {
  return getConfig().API_BASE_URL;
}

export const config = {
  get API_BASE_URL() {
    return getAPIBaseURL();
  },
};