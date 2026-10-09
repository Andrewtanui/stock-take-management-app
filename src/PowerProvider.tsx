import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getContext } from "@microsoft/power-apps/app";

// Inside Power Apps (via the Vite plugin Local Play URL or the published app)
// getContext() returns the signed-in user. In a plain browser preview there is
// no host, so we fall
// back to a demo identity and carry on.
interface Who {
  name: string;
  inPowerApps: boolean;
}
const Ctx = createContext<Who>({ name: "Achieng O.", inPowerApps: false });
export const useWho = () => useContext(Ctx);

export function PowerProvider({ children }: { children: ReactNode }) {
  const [who, setWho] = useState<Who>({ name: "Achieng O.", inPowerApps: false });
  useEffect(() => {
    let live = true;
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 1500));
    Promise.race([getContext().catch(() => null), timeout]).then((ctx) => {
      if (live && ctx?.user?.fullName) setWho({ name: ctx.user.fullName, inPowerApps: true });
    });
    return () => {
      live = false;
    };
  }, []);
  return <Ctx.Provider value={who}>{children}</Ctx.Provider>;
}
