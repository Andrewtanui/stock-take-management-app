// Signs in to Dataverse as the person running the script and caches the token
// outside the repo, so later runs are silent.
//
// Uses an interactive browser sign-in on this machine (the same method the
// Power Platform CLI uses). Device-code sign-in is blocked by the tenant's
// Conditional Access policy (AADSTS 53003), so it's only used if asked for
// with DATAVERSE_AUTH=device.
import { PublicClientApplication } from "@azure/msal-node";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ORG_URL = process.env.DATAVERSE_URL ?? "https://org6c75cfc0.crm4.dynamics.com";
const TENANT = process.env.DATAVERSE_TENANT ?? "94dd01c6-aa12-4c35-a812-c1079de28d6a";
// Power Platform CLI's public client (already allowed by the tenant's policies).
const CLIENT_ID = process.env.DATAVERSE_CLIENT_ID ?? "9cee029c-6210-4654-90bb-17e6e9d36617";
const CACHE_DIR = join(homedir(), ".ibky-stocktake");
const CACHE_FILE = join(CACHE_DIR, "msal-cache.json");

const cachePlugin = {
  async beforeCacheAccess(ctx) {
    if (existsSync(CACHE_FILE)) ctx.tokenCache.deserialize(readFileSync(CACHE_FILE, "utf8"));
  },
  async afterCacheAccess(ctx) {
    if (!ctx.cacheHasChanged) return;
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, ctx.tokenCache.serialize(), { mode: 0o600 });
  },
};

const pca = new PublicClientApplication({
  auth: { clientId: CLIENT_ID, authority: `https://login.microsoftonline.com/${TENANT}` },
  cache: { cachePlugin },
});

const scopes = [`${ORG_URL}/user_impersonation`];

function openBrowser(url) {
  // rundll32 hands the URL to the default browser without cmd.exe mangling '&'.
  spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
  console.log(`\n>>> SIGN IN: a browser tab has opened. If it didn't, open this link:\n${url}\n`);
  return Promise.resolve();
}

export async function getToken() {
  // The cache can hold sign-ins for several tenants (Pathways dev, NKG): use this tenant's.
  const accounts = (await pca.getTokenCache().getAllAccounts()).filter((a) => a.tenantId === TENANT);
  if (accounts.length) {
    try {
      return (await pca.acquireTokenSilent({ account: accounts[0], scopes })).accessToken;
    } catch {
      /* fall through to a fresh sign-in */
    }
  }
  const r =
    process.env.DATAVERSE_AUTH === "device"
      ? await pca.acquireTokenByDeviceCode({ scopes, deviceCodeCallback: (d) => console.log(`\n>>> SIGN IN: ${d.message}\n`) })
      : await pca.acquireTokenInteractive({
          scopes,
          openBrowser,
          successTemplate: "<h2>Signed in. You can close this tab and return to the terminal.</h2>",
          errorTemplate: "<h2>Sign-in failed: {{error}}</h2>",
        });
  console.log(`Signed in as ${r.account?.username}`);
  return r.accessToken;
}
