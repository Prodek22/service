const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const apiGet = <T>(path: string): Promise<T> => request(path, { method: 'GET' });

export const apiPost = <T>(path: string, body: Record<string, unknown>): Promise<T> =>
  request(path, {
    method: 'POST',
    body: JSON.stringify(body)
  });

export const apiPatch = <T>(path: string, body: Record<string, unknown>): Promise<T> =>
  request(path, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });

export const apiDelete = <T>(path: string): Promise<T> =>
  request(path, {
    method: 'DELETE'
  });

export const apiBaseUrl = API_BASE_URL;
