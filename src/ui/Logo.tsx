// NKG sub-brand logo lockup ("company name with two lines, version 2"):
// figurative mark | red line | company name in Lucida Bright, with a small
// second line. The official mark is not redrawn here: download it from the
// Comms N'Sider page (nkg2017.sharepoint.com/sites/Communications), save it as
// public/brand/nkg-mark.svg and set HAS_MARK to true.

const HAS_MARK = true;

export function Logo({ sub, negative }: { sub: string; negative?: boolean }) {
  return (
    <span className={"logo" + (negative ? " logo-negative" : "")} aria-label={`Ibero Kenya ${sub}`}>
      {HAS_MARK && <img className="logo-mark" src="./brand/nkg-mark.svg" alt="" />}
      <span className="logo-rule" aria-hidden />
      <span className="logo-text">
        <span className="logo-name">Ibero Kenya</span>
        <span className="logo-sub">{sub}</span>
      </span>
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
