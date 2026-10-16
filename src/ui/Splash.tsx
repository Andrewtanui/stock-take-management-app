import { CloudOff, RotateCw } from "lucide-react";

/** Shown while the data source loads at start-up. */
export function Splash() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <img className="splash-logo" src="./brand/nkg-mark.svg" alt="NKG East Africa" />
      <span className="spinner" aria-hidden />
      <p>Loading the stock take…</p>
    </div>
  );
}

/** A missing Dataverse privilege, in plain words: which record type, and who can fix it. */
function plain(message: string) {
  if (!/PrivilegeDenied|missing prv\w+ privilege/i.test(message)) return null;
  const what = message.match(/LocalizedName='([^']+)'/)?.[1];
  return `Your account doesn't have permission to read ${what ? `"${what}" records` : "some of the stock take data"} yet. Ask your Power Platform administrator to give you the Basic User role and your stock take (STK) role, then try again.`;
}

/** Shown when the data source can't load; the user can retry. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const friendly = plain(message);
  return (
    <div className="splash" role="alert">
      <img className="splash-logo" src="./brand/nkg-mark.svg" alt="NKG East Africa" />
      <div className="splash-card">
        <CloudOff size={28} aria-hidden />
        <strong>Couldn't load the stock take</strong>
        <p>{friendly ?? message}</p>
        {friendly && (
          <details className="splash-details">
            <summary>Show details</summary>
            <p>{message}</p>
          </details>
        )}
        <button className="btn btn-primary btn-lg btn-block" onClick={onRetry}>
          <RotateCw size={18} aria-hidden /> Try again
        </button>
      </div>
    </div>
  );
}
