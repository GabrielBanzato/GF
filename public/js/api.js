// Ao empacotar como app iOS (Capacitor), defina window.MIDAS_API_URL com o endereço do servidor.
const BASE = (window.MIDAS_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

let token = null;
export const setToken = (t) => { token = t; };

export async function api(method, path, body, { timeoutMs = 20000 } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError(0, 'network'); // offline ou servidor fora do ar
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'error');
  return data;
}
