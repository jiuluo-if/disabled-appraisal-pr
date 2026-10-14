# Disabled Appraisal

Source for two static assessment websites and their shared HTTPS AI proxy.

| Component | Directory | Deployment address |
| --- | --- | --- |
| Injury assessment | `analyst.lintsing.net/` | https://analyst.lintsing.net/ |
| Disability assessment | `appraise.lintsing.net/` | https://appraise.lintsing.net/ |
| Gemini-compatible Moonshot/Kimi proxy | `gemini/` | https://gemini.lintsing.net:3000/ |

## Static Websites

Deploy each website directory to the matching BaoTa site root:

```text
/www/wwwroot/analyst.lintsing.net/
/www/wwwroot/appraise.lintsing.net/
```

Both pages send analysis requests to
`https://gemini.lintsing.net:3000/api/analyze`. Change `PROXY_URL` in each
`index.html` when deploying the proxy elsewhere. Direct Google API keys have
been removed; keep provider credentials on the server.

The pages load React, Tailwind and Babel from external CDNs. Babel is pinned
to version 7.26.0, which avoids the blank-page errors encountered with the
unpinned version. The two sites are static and do not need a Node process.

## HTTPS Proxy

Use Node.js 18 or newer. The service accepts Gemini-style `contents` requests
at `POST /api/analyze`, forwards them to Moonshot and returns Gemini-style
`candidates` responses. Text and image models are configured independently.

```sh
cd gemini
npm ci
cp .env.example .env
```

Edit `.env` to supply your Moonshot API key and models available to your
account. The original `moonshot-v1-8k` text model returned HTTP 404 during the
production check; verify access and set `KIMI_TEXT_MODEL` and
`KIMI_VISION_MODEL` before using the analysis API. This import preserves the
original model defaults.

Install the certificate chain and matching private key outside Git, using the
paths configured by `SSL_CERT_PATH` and `SSL_KEY_PATH`. Their default filenames
are `gemini.lintsing.net.pem` and `gemini.lintsing.net.key` inside `gemini/`.
Restrict `.env` and the private key to the service account.

```sh
npm run check
npm start
```

The default HTTPS port is 3000. Verify the TLS certificate and health endpoint:

```sh
curl https://gemini.lintsing.net:3000/
```

The response should be `Kimi HTTPS Proxy is Running!`. A successful health
response does not by itself verify upstream model access.

## BaoTa Deployment

`deploy/nginx/` contains the two sites' existing BaoTa Nginx configurations.
They reference BaoTa-managed include files and certificate paths, so they are
deployment references, not standalone configurations for a fresh Nginx server.
Use them with the corresponding BaoTa sites and directories already created.

The static-site TLS files belong at:

```text
/www/server/panel/vhost/cert/analyst.lintsing.net/fullchain.pem
/www/server/panel/vhost/cert/analyst.lintsing.net/privkey.pem
/www/server/panel/vhost/cert/appraise.lintsing.net/fullchain.pem
/www/server/panel/vhost/cert/appraise.lintsing.net/privkey.pem
```

After changing these certificates, test the configuration before reloading:

```sh
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf
```

For the proxy, place `gemini/` at `/www/wwwroot/gemini/`, install its dependencies,
and configure `.env` and TLS files before installing the systemd unit:

```sh
sudo install -m 644 deploy/systemd/gemini.service /etc/systemd/system/gemini.service
sudo systemctl daemon-reload
sudo systemctl enable --now gemini.service
sudo systemctl status gemini.service
```

The unit uses `/usr/bin/node`; adjust it if Node is installed elsewhere. Restart
the proxy after updating its `.env`, certificate or private key:

```sh
sudo systemctl restart gemini.service
```

## Repository Contents

API keys, `.env`, TLS certificates, private keys, dependency directories,
runtime logs and server backup files are excluded from Git. Reinstall
dependencies with the committed `package-lock.json` and provision credentials
and certificates separately. The checked-in proxy source is UTF-8; the source
downloaded from the server used GB18030.
