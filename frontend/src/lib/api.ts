const EXTERNAL_API_URL = import.meta.env.VITE_API_URL || '';

async function apiFetch(url: string, method: string, data?: unknown, headers?: Record<string, string>) {
  const fullUrl = `${EXTERNAL_API_URL}${url}`;
  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  const res = await fetch(fullUrl, {
    method,
    headers: fetchHeaders,
    body: method !== 'GET' && data ? JSON.stringify(data) : undefined,
  });

  let responseData: unknown;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    responseData = await res.json();
  } else {
    responseData = await res.text();
  }

  return { data: responseData, status: res.status };
}

export const client = {
  apiCall: {
    invoke: async ({ url, method, data, options }: {
      url: string;
      method: string;
      data?: unknown;
      options?: { headers?: Record<string, string> };
    }) => {
      return apiFetch(url, method, data, options?.headers);
    },
  },
  auth: {
    me: async () => ({ data: null }),
    logout: async () => {},
    login: async () => {},
  },
};
