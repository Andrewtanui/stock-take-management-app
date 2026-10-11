import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { useStore } from "../data/store";
import { Dialog } from "./kit";

/** "Photo" button for a record that has a counter's photo; opens it full size. */
export function PhotoButton({ id, title }: { id: string; title: string }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = () => {
    setOpen(true);
    if (src) return;
    store
      .photo(id)
      .then((p) => setSrc(`data:${p.mime};base64,${p.base64}`))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={show}>
        <ImageIcon size={14} aria-hidden /> Photo
      </button>
      {open && (
        <Dialog title={title} onClose={() => setOpen(false)}>
          {error ? <p className="t-crit">{error}</p> : src ? <img className="photo-full" src={src} alt={title} /> : <p className="muted">Loading the photo…</p>}
          {src && (
            <div className="btn-row">
              <a className="btn btn-sm" href={src} download={`${title}.jpg`}>
                Download
              </a>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
