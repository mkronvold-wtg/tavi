export const appName = "tavi";
export { appVersion } from "./app-version.js";
export { buildEmailHtml, escapeHtml, parseSmtpUrl } from "./email.js";
export const appRepositoryUrl = "https://github.com/mkronvold-wtg/tavi";

export const defaultPorts = {
  api: 4000,
  web: 5173,
  worker: 4100,
  postgres: 5432,
} as const;
