export type AuthErrorResponse = {
  status: number;
  statusText: string;
  body: string;
};

const authErrorResponses = new Map<string, AuthErrorResponse>();

export function recordAuthErrorResponse(url: string, response: AuthErrorResponse) {
  authErrorResponses.set(url, response);
}

export function takeAuthErrorResponse(url: string): AuthErrorResponse | undefined {
  const response = authErrorResponses.get(url);
  authErrorResponses.delete(url);
  return response;
}
