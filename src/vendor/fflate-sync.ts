// fflate without Web Workers. The Power Apps player won't run them, and fflate's async
// zip()/unzip() hand anything big to a blob: worker that never answers there - so reading
// an XBS import (read-excel-file) or downloading a large report (write-excel-file) waited
// forever. vite.config.ts points "fflate" here; this does the same work on the main
// thread with fflate's synchronous functions and keeps the async callback signature.
import * as real from "fflate-real";
export * from "fflate-real";

type Done<T> = (err: real.FlateError | null, data: T) => void;
const later = <T,>(work: () => T, done: Done<T>) =>
  queueMicrotask(() => {
    let out: T;
    try {
      out = work();
    } catch (e) {
      done(e as real.FlateError, null as never);
      return;
    }
    done(null, out);
  });

export function unzip(data: Uint8Array, opts: real.AsyncUnzipOptions | Done<real.Unzipped>, cb?: Done<real.Unzipped>): real.AsyncTerminable {
  const done = (typeof opts === "function" ? opts : cb)!;
  const o = typeof opts === "function" ? {} : opts;
  later(() => real.unzipSync(data, o as real.UnzipOptions), done);
  return () => {};
}

export function zip(data: real.AsyncZippable, opts: real.AsyncZipOptions | Done<Uint8Array>, cb?: Done<Uint8Array>): real.AsyncTerminable {
  const done = (typeof opts === "function" ? opts : cb)!;
  const o = typeof opts === "function" ? {} : opts;
  later(() => real.zipSync(data as real.Zippable, o as real.ZipOptions), done);
  return () => {};
}
