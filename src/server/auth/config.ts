export interface AuthConfig {
  /** Public base URL of this app, e.g. http://localhost:5001 or https://online.viber.global */
  appUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  /** GitHub handles (lowercase) that become admins when they log in. */
  adminHandles: string[];
  /** Reject GitHub accounts younger than this (anti-throwaway). 0 disables the check. */
  minAccountAgeDays: number;
  secureCookies: boolean;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig | null {
  const githubClientId = env.GITHUB_CLIENT_ID?.trim();
  const githubClientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  if (!githubClientId || !githubClientSecret) return null;
  const appUrl = (env.APP_URL?.trim() || `http://localhost:${env.PORT ?? 5001}`).replace(/\/+$/, "");
  const age = Number(env.MIN_GITHUB_ACCOUNT_AGE_DAYS ?? 14);
  return {
    appUrl,
    githubClientId,
    githubClientSecret,
    adminHandles: (env.ADMIN_GITHUB_HANDLES ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
    minAccountAgeDays: Number.isFinite(age) && age >= 0 ? age : 14,
    secureCookies: appUrl.startsWith("https://"),
  };
}
