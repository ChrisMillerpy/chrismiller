/**
 * Environment that lets git and gh use the GitHub token for one command.
 * Passed with every command, because each command in the box starts with a clean
 * environment (env given when the box starts never reaches them). Nothing is
 * written to disk: git reads the URL rewrite from GIT_CONFIG_* variables.
 */
export function gitAuthEnv(token: string | undefined): Record<string, string> {
  if (!token) return {};
  return {
    GH_TOKEN: token,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.https://x-access-token:${token}@github.com/.insteadOf`,
    GIT_CONFIG_VALUE_0: 'https://github.com/',
  };
}
