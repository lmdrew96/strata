// Shared between the login/logout API routes and proxy.ts -- the cookie
// value itself is the password, so proxy can verify it against
// process.env.ADMIN_PASSWORD without a session store.
export const ADMIN_AUTH_COOKIE = "admin_auth";
