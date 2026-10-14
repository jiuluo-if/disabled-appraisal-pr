# Disabled Appraisal

Two assessment websites and a shared HTTPS service, with separate injury and
disability standards. Both websites are built from shared React components.

| Component | Source | Production |
| --- | --- | --- |
| Injury severity | `analyst.lintsing.net/` | https://analyst.lintsing.net/ |
| Disability grade | `appraise.lintsing.net/` | https://appraise.lintsing.net/ |
| Analysis service | `gemini/` | https://gemini.lintsing.net:3000/ |

## Results

The service retrieves relevant clauses from pinned official legal texts. It
requests a structured response and validates its types, cited clause IDs, grade
system, supporting conditions and verbatim evidence before returning a result.
Canonical clause wording, grade and source links come from the local catalog,
not model-generated citations.

The result separates the conclusion, submitted facts, clause comparisons,
missing materials, further review and uncertainty. A preliminary grade requires
supporting conditions and traceable evidence. Missing required evidence,
unsupported citations or incompatible grades cause the grade to be removed.
Ongoing treatment also prevents a disability grade. A model or network failure
returns an error; there is no automatic mock assessment.

Images are transcribed before clause retrieval. Unreadable content is not filled
in, and image transcription remains explicitly subject to manual checking. The
service does not diagnose injuries directly from raw X-ray or CT images.

These checks improve traceability; they do not establish clinical truth, prove
that every condition is satisfied, or replace a qualified forensic assessment.
The rules are model-assisted, not a certified medical decision engine. No
uncalibrated confidence percentages or compensation estimates are generated.

## Standards

`gemini/data/injury.json` contains 390 grading items from the 2013 published
version of *The Standard for Assessment of Human Injury Severity*, effective
2014-01-01. `gemini/data/disability.json` contains 457 grading items from the
2016 published version of *The Grading of Disability Caused by Human Injury*,
effective 2017-01-01. Each catalog includes principles, source URLs, the explicit
edition and a checksum of its source document. Appendices, specialized standards
and subsequent amendments still require professional review.

Official sources:

- [Injury standard: Ministry of Ecology and Environment government publication](https://jjjcz.mee.gov.cn/djfg/gjflfg/sfjs/201308/t20130830_445612.html)
- [Disability standard: Ministry of Justice announcement](https://www.moj.gov.cn/pub/sfbgwapp/zwgk/tzggApp/202105/t20210517_395433.html)
- [Disability standard: official Tai'an Justice Bureau PDF copy](https://sfj.taian.gov.cn/module/download/downfile.jsp?classid=0&filename=657c49dd386d41d3a0b913c63e332dbb.pdf)

`scripts/import-standards.py` rebuilds the catalog from the government HTML and
the PDF's `pdftotext -layout` extract. It requires Python, BeautifulSoup and
Poppler. Regression tests cover source counts and previously incorrect examples,
including the difference between partial and total spleen removal.

## Local Development

Use Node.js 20.19+ or a supported newer LTS version.

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix gemini
cp gemini/.env.example gemini/.env
```

Configure the Moonshot key and certificates in `gemini/.env`. The default text
and vision model is `kimi-k2.6`, verified against the deployment account. Provider
models and access can change; `/api/health/ready` checks the configured model IDs.
`KIMI_THINKING`, `KIMI_JSON_MODE`, token budget and overall analysis timeout can
be configured through `.env`. Use the provider's documented supported values.

Start the backend from its own working directory:

```sh
cd gemini
npm start
```

Start the frontend from the repository root in another terminal:

```sh
npm run dev
```

- http://127.0.0.1:5300/analyst.lintsing.net/
- http://127.0.0.1:5300/appraise.lintsing.net/

The dev proxy targets `https://127.0.0.1:3000`. For the existing production
backend, use `DEV_API_URL=https://gemini.lintsing.net:3000 npm run dev`.
`VITE_API_BASE` can override the browser API prefix at build time; do not put
provider keys into frontend environment variables.

## Build and Test

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The automated checks cover citation and evidence validation, differing grading
systems, incomplete results, corrupted history, request timeouts, cancellation,
provider errors, text/image uploads, desktop/mobile rendering and report export.
CI runs these checks without production credentials or paid model requests.

`dist/` is generated and ignored by Git. React, icons, styles and validation code
are served locally from bundled assets; no runtime Babel or external CDN is
required.

## BaoTa Deployment

Build first. Copy `dist/analyst.lintsing.net/index.html` to the analyst site root,
`dist/appraise.lintsing.net/index.html` to the appraise site root, and the entire
`dist/assets/` directory into **each** site root's `assets/` directory. Keep older
hashed assets during upgrades so already-open pages can finish loading.

Copy `gemini/server.js`, `gemini/lib/`, `gemini/data/`, `gemini/package.json` and
`gemini/package-lock.json` to `/www/wwwroot/gemini/`, then run `npm ci` there.
Provision `.env` and matching TLS files separately, with permissions restricting
the API key and private key to the service account.

The existing BaoTa configurations are in `deploy/nginx/html_*.conf`. Install
`deploy/nginx/assessment-api.conf` as an extension in **both** directories:

```text
/www/server/panel/vhost/nginx/extension/analyst.lintsing.net/assessment-api.conf
/www/server/panel/vhost/nginx/extension/appraise.lintsing.net/assessment-api.conf
```

This forwards same-origin `/api/` requests to the existing HTTPS service, verifies
its certificate and gives versioned assets long-lived caching. Adjust the CA
bundle path for your operating system; the deployed server uses
`/etc/pki/tls/certs/ca-bundle.crt`. API authentication, traffic limits and quotas
are intentionally unchanged.

```sh
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf
sudo install -m 644 deploy/systemd/gemini.service /etc/systemd/system/gemini.service
sudo systemctl daemon-reload
sudo systemctl enable --now gemini.service
sudo systemctl restart gemini.service
```

The unit uses `/usr/bin/node` and requires `/www/wwwroot/gemini/.env`.
Back up the previous code, dependency lockfile, configuration and certificates
before deploying. Test the new backend before switching the frontend.

## Health and Certificates

- `GET /`: legacy process health message.
- `GET /api/health/live`: process liveness.
- `GET /api/health/ready`: configured model access, using a short-lived cache.
- `GET /api/standards/injury` and `/api/standards/disability`: pinned official text.
- `POST /api/analyze`: structured input (`assessmentType`, `description`, `images`,
  `injuryDate`, `treatmentStatus`); the legacy Gemini `contents` format remains
  accepted during migration.

The Node service must restart after its TLS files are changed. BaoTa's two static
sites use their own `fullchain.pem` and `privkey.pem` under
`/www/server/panel/vhost/cert/<domain>/`; test and reload Nginx after updating them.

Install daily HTTPS, certificate-expiry and readiness monitoring:

```sh
sudo install -m 644 scripts/healthcheck.mjs /www/wwwroot/gemini/healthcheck.mjs
sudo install -m 644 deploy/systemd/assessment-health.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/assessment-health.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now assessment-health.timer
sudo systemctl start assessment-health.service
sudo journalctl -u assessment-health.service
```

The check fails when a site cannot be reached, model IDs are unavailable or a
certificate has fewer than 21 days left. Checks are recorded in the systemd
journal; external messaging is not configured. Certificates still need renewal
through their issuer or a separately configured BaoTa ACME workflow.

## Local Records and Secrets

Results are saved only when the user explicitly chooses Save. Images themselves
are not saved. History is bounded to 50 records and can be cleared or exported.
Legacy records remain available for export but are not treated as verified
results, because the old application could save mock assessments.

API keys, `.env`, TLS files, logs, server backups, dependencies, build outputs and
test artifacts are excluded from Git. The deployed service and repository use
UTF-8, correcting the old GB18030 service source. Logs contain request IDs,
duration and status, not report content or credentials.
