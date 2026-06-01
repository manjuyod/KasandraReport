const DEFAULT_BACKEND_PORT = '8080';

export const resolveBackendProxyTarget = (env: Record<string, string | undefined>): string => {
  const backendUrl = env.BACKEND_URL?.trim();
  if (backendUrl) {
    return backendUrl;
  }

  const backendPort = env.BACKEND_PORT?.trim() || env.PORT?.trim() || DEFAULT_BACKEND_PORT;
  return `http://localhost:${backendPort}`;
};
