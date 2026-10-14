import https from 'node:https';

const targets = [
  'https://analyst.lintsing.net/',
  'https://appraise.lintsing.net/',
  'https://gemini.lintsing.net:3000/api/health/ready',
];
const threshold = Number(process.env.CERT_WARN_DAYS || 21);
const results = await Promise.all(targets.map(url => new Promise(resolve => {
  const request = https.get(url, { timeout: 15000 }, response => {
    const certificate = response.socket.getPeerCertificate();
    const remainingDays = Math.floor((Date.parse(certificate.valid_to) - Date.now()) / 86400000);
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; });
    response.on('end', () => {
      let ready = true;
      if (url.includes('/health/ready')) {
        try { ready = JSON.parse(body).configuredModelsAvailable === true; } catch { ready = false; }
      }
      resolve({ url, status: response.statusCode, certificateDaysRemaining: remainingDays,
        ok: response.statusCode === 200 && remainingDays >= threshold && ready });
    });
  });
  request.on('timeout', () => request.destroy(new Error('Request timed out')));
  request.on('error', error => resolve({ url, ok: false, error: error.code || error.message }));
})));
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), warningThresholdDays: threshold, results }, null, 2));
if (results.some(result => !result.ok)) process.exitCode = 1;
