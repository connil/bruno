export const buildBearerAuthHeader = (auth?: { token?: string | null; prefix?: string | null } | null): string => {
  const prefix = auth?.prefix || 'Bearer';
  return `${prefix} ${auth?.token ?? ''}`;
};
