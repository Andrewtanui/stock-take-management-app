// The official NKG East Africa logo (negative version, public/brand/nkg-mark.svg)
// on the Neumann green header, followed by the app name. The brand book allows
// the negative logo on dark surfaces; the file is used unmodified.

export function Logo({ sub }: { sub: string }) {
  return (
    <span className="logo">
      <span className="logo-crop">
        <img src="./brand/nkg-mark.svg" alt="NKG East Africa" />
      </span>
      <span className="logo-app">{sub}</span>
    </span>
  );
}

/** Brand headline: a BLACK statement and a light line. */
export function Headline({ black, light, as: Tag = "h1" }: { black: string; light: string; as?: "h1" | "h2" }) {
  return (
    <Tag className="headline">
      <span className="headline-black">{black}</span>
      <span className="headline-light">{light}</span>
    </Tag>
  );
}
