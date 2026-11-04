import { ExternalLink } from "lucide-react";
import { PageHead } from "../ui/kit";

// Nicole's Power BI report in the NKG Fabric workspace (reads NKG_Demo). The viewer's own Microsoft
// sign-in opens it (autoAuth), so they need access to the workspace or the report.
const TENANT = "321a398d-e261-4d65-adec-c9cc85f02498";
const WORKSPACE = "85729121-1cb4-4975-9e36-de8343b2a87a";
const REPORT = "1ac51105-68f8-4ccf-a277-b9b5c3751559";
const EMBED = `https://app.powerbi.com/reportEmbed?reportId=${REPORT}&groupId=${WORKSPACE}&autoAuth=true&ctid=${TENANT}`;
const OPEN = `https://app.fabric.microsoft.com/groups/${WORKSPACE}/reports/${REPORT}?ctid=${TENANT}`;

/** Reports › Dashboards: the Power BI dashboards on the same Dataverse data, inside the Hub. */
export default function Dashboards() {
  return (
    <div className="page">
      <PageHead
        title="Dashboards"
        sub="Power BI dashboards on the same stock take data: count day live, Level 1 reconciliation and more. Opens with your Microsoft sign-in."
        actions={
          <a className="btn" href={OPEN} target="_blank" rel="noreferrer">
            <ExternalLink size={16} aria-hidden /> Open in Power BI
          </a>
        }
      />
      <section className="panel dash-panel">
        <iframe className="dash-frame" title="Stock take dashboards (Power BI)" src={EMBED} allowFullScreen />
        <p className="muted small">
          Blank or asking you to sign in? Use Open in Power BI. If it says you don't have access, ask the report owner to share the workspace with you.
        </p>
      </section>
    </div>
  );
}
