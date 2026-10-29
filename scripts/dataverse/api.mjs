// Thin Dataverse Web API client: auth header, solution header, retries.
import { ORG_URL, getToken } from "./auth.mjs";

const BASE = `${ORG_URL}/api/data/v9.2/`;
let token;

export async function dv(method, path, body, { solution, allow404 = false } = {}) {
  token ??= await getToken();
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(BASE + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json; charset=utf-8",
          "OData-MaxVersion": "4.0",
          "OData-Version": "4.0",
          ...(solution ? { "MSCRM.SolutionUniqueName": solution } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // A dropped connection (ECONNRESET etc.): wait and try again. The scripts only add, so a
      // POST that did land shows up on the next run as "already exists".
      if (attempt < 6) {
        console.log(`   … connection dropped (${e.cause?.code ?? e.message}), retrying in ${attempt * 4}s`);
        await new Promise((r) => setTimeout(r, attempt * 4000));
        continue;
      }
      throw e;
    }
    if (res.status === 404 && allow404) return null;
    if (res.status === 401 && attempt === 1) {
      token = await getToken();
      continue;
    }
    // Metadata calls can be throttled or hit a concurrent customisation lock.
    // Retry throttling/transient gateway errors; a plain 500 is usually a real
    // error, so it gets one retry only.
    const transient = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
    if ((transient && attempt < 6) || (res.status === 500 && attempt < 2)) {
      const wait = Number(res.headers.get("Retry-After") ?? 0) * 1000 || attempt * 4000;
      console.log(`   … ${res.status}, retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}\n${text.slice(0, 1500)}`);
    return text ? JSON.parse(text) : { id: res.headers.get("OData-EntityId") };
  }
}

export const exists = async (path) => (await dv("GET", path, undefined, { allow404: true })) !== null;
