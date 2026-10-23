export function geminiRegistration(callback) {
  const url = new URL(callback);
  if (url.origin !== "https://oauth-redirect.googleusercontent.com" || url.username || url.password || url.search || url.hash ||
      !/^\/r\/[A-Za-z0-9_-]+$/.test(url.pathname) || callback !== url.href) {
    throw new Error("Exact observed production Google OAuth relay callback required; no wildcard or inferred callback");
  }
  return {
    name: "Gemini synthetic household test", redirectUris: [callback], tokenEndpointAuthMethod: "none",
    scopes: ["shopping:read", "chores:read", "notes:read", "offline_access"],
    provider: "gemini", profileVersion: "who-477.gemini.synthetic.v1", dataMode: "synthetic", enabled: true,
  };
}
