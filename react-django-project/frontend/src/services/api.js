import axios from "axios";

// During development talk to local Django server directly on port 8000.
// In production the app is served behind a reverse proxy (ngrok, nginx, IIS)
// that already routes requests to Django — so we use the same origin as the
// page itself (no explicit port). Appending :8000 to an ngrok/proxy hostname
// causes ERR_CONNECTION_TIMED_OUT because the proxy only listens on 443/80.
export const baseURL = import.meta.env.DEV
  ? "http://127.0.0.1:8010"
  : location.origin;

export const api = axios.create({
  baseURL,
  withCredentials: true,
});

export const setAuthToken = (token) => {
  if (token) {
    // prefix token with 'Bearer ' for endpoints that expect it
    api.defaults.headers.common["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    localStorage.setItem("token", token);
  } else {
    delete api.defaults.headers.common["Authorization"];
    localStorage.removeItem("token");
  }
};
