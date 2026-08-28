#!/usr/bin/env node
/**
 * Descarga media/tribu-hero.mp4 desde GitHub LFS sin git-lfs (para cPanel).
 * Uso: node site/scripts/fetch-hero-media.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const REPO = process.env.VHM_GITHUB_REPO || 'r1305/vhm';
const MIN_OK_BYTES = 1000000;
const heroPath = path.resolve(__dirname, '../../media/tribu-hero.mp4');
const DEFAULT_OID = '6e912783da515917d4d3dabcf459b5d9ed9f2008f578ffdfe71b2a6627626404';
const DEFAULT_SIZE = 1357577878;

function requestJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      u,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.git-lfs+json',
          'Content-Type': 'application/vnd.git-lfs+json',
          'User-Agent': 'vhm-deploy/1.0',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`LFS batch HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (targetUrl, redirects) => {
      if (redirects > 8) {
        reject(new Error('Demasiadas redirecciones'));
        return;
      }
      const u = new URL(targetUrl);
      const lib = u.protocol === 'https:' ? https : http;
      lib.get(u, { headers: { 'User-Agent': 'vhm-deploy/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(new URL(res.headers.location, u).href, redirects + 1);
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Download HTTP ${res.statusCode}`));
          return;
        }
        const tmp = `${dest}.part`;
        const file = fs.createWriteStream(tmp);
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            fs.renameSync(tmp, dest);
            resolve();
          });
        });
        file.on('error', (err) => {
          fs.unlink(tmp, () => {});
          reject(err);
        });
      }).on('error', reject);
    };
    follow(url, 0);
  });
}

function readPointerMeta(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const oidMatch = text.match(/^oid sha256:([a-f0-9]+)$/m);
  const sizeMatch = text.match(/^size (\d+)$/m);
  return {
    oid: oidMatch ? oidMatch[1] : DEFAULT_OID,
    size: sizeMatch ? parseInt(sizeMatch[1], 10) : DEFAULT_SIZE,
  };
}

async function main() {
  if (fs.existsSync(heroPath) && fs.statSync(heroPath).size >= MIN_OK_BYTES) {
    console.log(`[vhm] Hero media OK (${fs.statSync(heroPath).size} bytes)`);
    return;
  }

  const meta = fs.existsSync(heroPath) ? readPointerMeta(heroPath) : { oid: DEFAULT_OID, size: DEFAULT_SIZE };
  console.log(`[vhm] Descargando tribu-hero.mp4 (${meta.size} bytes) desde GitHub LFS...`);

  const batchBody = JSON.stringify({
    operation: 'download',
    transfers: ['basic'],
    objects: [{ oid: meta.oid, size: meta.size }],
  });
  const batch = await requestJson(`https://github.com/${REPO}.git/info/lfs/objects/batch`, batchBody);
  const href = batch?.objects?.[0]?.actions?.download?.href;
  if (!href) {
    throw new Error('GitHub no devolvió URL de descarga LFS. ¿Repo privado? Define GITHUB_TOKEN o sube el MP4 por FTP.');
  }

  fs.mkdirSync(path.dirname(heroPath), { recursive: true });
  await downloadFile(href, heroPath);

  const finalSize = fs.statSync(heroPath).size;
  if (finalSize < MIN_OK_BYTES) {
    throw new Error(`Descarga incompleta (${finalSize} bytes)`);
  }
  console.log(`[vhm] Listo: ${heroPath} (${finalSize} bytes)`);
}

main().catch((err) => {
  console.error('[vhm] Error:', err.message);
  console.error('[vhm] Alternativa: sube media/tribu-hero.mp4 (~1.3 GB) por FTP/cPanel File Manager.');
  process.exit(1);
});
