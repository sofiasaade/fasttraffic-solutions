// Public legal pages required by Intuit's production-app checklist (ATLAS F1d).
// Intentionally public (no session): Intuit's reviewers must be able to open them.
import type { Express } from "express";

const COMPANY = "Fast Traffic Solutions Ltd.";
const APP = "FTS ATLAS";
const CONTACT = "sofia@ftstraffic.ca";
const UPDATED = "September 3, 2026";

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ${APP}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f6f7fb; color: #1e2b58; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  .brand { font-weight: 800; font-size: 20px; letter-spacing: -0.3px; }
  .brand span { color: #e8542f; }
  h1 { font-size: 26px; margin: 18px 0 4px; }
  .updated { color: #6b7280; font-size: 13px; margin-bottom: 22px; }
  h2 { font-size: 17px; margin-top: 26px; }
  p, li { line-height: 1.55; font-size: 15px; color: #333c55; }
  .card { background: #fff; border: 1px solid #e5e7ef; border-radius: 14px; padding: 26px 28px; }
</style>
</head>
<body><div class="wrap">
<div class="brand">FAST<span>»</span>TRAFFIC</div>
<h1>${title}</h1>
<div class="updated">${APP} · Last updated ${UPDATED}</div>
<div class="card">${body}</div>
</div></body></html>`;
}

const EULA_BODY = `
<p><b>${APP}</b> is an internal business application owned and operated by ${COMPANY},
a traffic-control company based in Calgary, Alberta, Canada. It is used exclusively by
the owner and staff of ${COMPANY} to view reports about the company's own operations.
It is not offered, sold, or licensed to the public.</p>
<h2>1. License</h2>
<p>Access is granted only to personnel authorized by ${COMPANY}. No other person may use
the application. All rights are reserved by ${COMPANY}.</p>
<h2>2. QuickBooks connection</h2>
<p>The application connects to the company's own QuickBooks Online file through Intuit's
official OAuth 2.0 authorization. The connection is <b>read-only by design</b>: the
application only retrieves data (invoices, balances, reports) and never creates, edits,
or deletes anything in QuickBooks, and never sends communications on the company's behalf.</p>
<h2>3. No warranty</h2>
<p>The application is provided "as is" for internal reporting. Figures shown are drawn
from their named sources; where data is unavailable it is reported as unavailable rather
than estimated.</p>
<h2>4. Termination</h2>
<p>${COMPANY} may revoke access or disconnect the QuickBooks integration at any time from
within the application, which also revokes the token at Intuit.</p>
<h2>5. Contact</h2>
<p>Questions about this agreement: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
`;

const PRIVACY_BODY = `
<p><b>${APP}</b> is an internal reporting application used only by ${COMPANY} to view
data about its own business. We do not sell products or services through this
application, and we do not collect data from the public.</p>
<h2>1. What data the application handles</h2>
<ul>
<li><b>Company operations data</b> from our own systems (jobs, invoices, schedules).</li>
<li><b>Accounting data from our own QuickBooks Online file</b>, accessed read-only through
Intuit's official OAuth 2.0 flow. We never receive or store QuickBooks passwords.</li>
<li><b>Access logs</b> for the executive module (sign-ins and views), kept for security auditing.</li>
</ul>
<h2>2. How it is used</h2>
<p>Solely to display reports to authorized personnel of ${COMPANY}. Data is never sold,
shared with third parties, or used for advertising. The application never writes to
QuickBooks and never sends automated communications.</p>
<h2>3. Storage and security</h2>
<p>Data is stored in the application's own database with encrypted connections (TLS).
Access to the executive module requires an individual password and multi-factor
authentication. OAuth tokens are stored server-side and are revoked at Intuit upon
disconnection.</p>
<h2>4. Data retention and deletion</h2>
<p>The QuickBooks connection can be removed at any time from within the application,
which revokes the token at Intuit and deletes it from our database. Other records are
retained only as long as needed for the company's own bookkeeping and safety-compliance
obligations.</p>
<h2>5. Contact</h2>
<p>Privacy questions: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
`;

export function registerLegalPages(app: Express) {
  app.get("/legal/eula", (_req, res) => {
    res.type("html").send(page("End-User License Agreement", EULA_BODY));
  });
  app.get("/legal/privacy", (_req, res) => {
    res.type("html").send(page("Privacy Policy", PRIVACY_BODY));
  });
}
