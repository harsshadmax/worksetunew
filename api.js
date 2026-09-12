// api.js — backend API client. Talks to the EXACT same Worksetu backend
// contract as the original site (https://worksetu-web.onrender.com) — same
// routes, same request/response shapes, same auth model. Zero backend
// changes were made or are required for this file to work.
//
// Auth model (unchanged from the original): the access token lives only in
// memory (never localStorage) and the refresh token lives in an httpOnly,
// Secure, SameSite cookie set by the server — this file never reads or
// writes that cookie directly, only sends it via credentials: "include".
//
// Trimmed from the original api.js: no Socket.io client. This MVP uses
// on-demand polling/refresh instead of a persistent WebSocket connection —
// a deliberate weight/latency trade-off (one less always-open connection
// and one less ~40KB+ client library to download and parse), reasonable
// for a first pass. Reintroducing live push later needs no backend change
// either, since the server already speaks Socket.io.
(function () {
  const API_BASE = (window.WORKSETU_API_BASE || "http://localhost:4000") + "/api/v1";

  let accessToken = null;
  let refreshInFlight = null;
  let onSessionExpired = null;

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  function setAccessToken(token) {
    accessToken = token;
  }
  function getAccessToken() {
    return accessToken;
  }
  function clearAccessToken() {
    accessToken = null;
  }
  function onExpired(handler) {
    onSessionExpired = handler;
  }

  async function refreshSession() {
    if (!refreshInFlight) {
      refreshInFlight = fetch(`${API_BASE}/auth/refresh`, { method: "POST", credentials: "include" })
        .then(async (res) => {
          if (!res.ok) throw new Error("REFRESH_FAILED");
          const body = await res.json();
          setAccessToken(body.token);
          return body.token;
        })
        .finally(() => {
          refreshInFlight = null;
        });
    }
    return refreshInFlight;
  }

  async function parseErrorEnvelope(res) {
    try {
      const body = await res.json();
      return new ApiError(res.status, body?.error?.code || "UNKNOWN_ERROR", body?.error?.message || "Something went wrong");
    } catch {
      return new ApiError(res.status, "UNKNOWN_ERROR", "Something went wrong");
    }
  }

  async function request(method, path, { body, idempotencyKey, params, isRetry } = {}) {
    let url = `${API_BASE}${path}`;
    if (params) {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
      const qsString = qs.toString();
      if (qsString) url += `?${qsString}`;
    }

    const headers = { "Content-Type": "application/json" };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const res = await fetch(url, {
      method,
      credentials: "include",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    if (res.status === 401 && !isRetry && accessToken !== null) {
      try {
        await refreshSession();
        return request(method, path, { body, idempotencyKey, params, isRetry: true });
      } catch {
        clearAccessToken();
        if (onSessionExpired) onSessionExpired();
        throw new ApiError(401, "SESSION_EXPIRED", "Your session has expired, please log in again");
      }
    }

    if (!res.ok) throw await parseErrorEnvelope(res);
    if (res.status === 204) return null;
    return res.json();
  }

  function idempotencyKey() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  }

  window.ApiClient = {
    request,
    idempotencyKey,
    setAccessToken,
    getAccessToken,
    clearAccessToken,
    onExpired,
    refreshSession,
    ApiError
  };
})();
