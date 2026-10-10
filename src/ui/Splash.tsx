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

/** Shown when the data source can't load; the counter can retry. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="splash" role="alert">
      <img className="splash-logo" src="./brand/nkg-mark.svg" alt="NKG East Africa" />
      <div className="splash-card">
        <CloudOff size={28} aria-hidden />
        <strong>Couldn't load the stock take</strong>
        <p>{message}</p>
        <button className="btn btn-primary btn-lg btn-block" onClick={onRetry}>
          <RotateCw size={18} aria-hidden /> Try again
        </button>
      </div>
    </div>
  );
}
