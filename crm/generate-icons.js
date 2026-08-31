// Genera íconos SVG para la PWA
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function makeIconSVG(size) {
  const r = size * 0.18; // border-radius
  const cx = size / 2;
  const cy = size / 2;
  const vhmSize = Math.round(size * 0.32);
  const crmSize = Math.round(size * 0.16);
  const vhmY = Math.round(cy - size * 0.04);
  const crmY = Math.round(cy + size * 0.18);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#7c3aed"/>
  <text x="${cx}" y="${vhmY}" font-family="Arial,Helvetica,sans-serif" font-size="${vhmSize}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">VHM</text>
  <text x="${cx}" y="${crmY}" font-family="Arial,Helvetica,sans-serif" font-size="${crmSize}" font-weight="600" fill="rgba(255,255,255,0.85)" text-anchor="middle" dominant-baseline="middle">CRM</text>
</svg>`;
}

function makeSplashSVG(size) {
  const cx = size / 2;
  const cy = size / 2;
  const vhmSize = Math.round(size * 0.12);
  const crmSize = Math.round(size * 0.06);
  const vhmY = Math.round(cy - size * 0.02);
  const crmY = Math.round(cy + size * 0.07);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#7c3aed"/>
  <text x="${cx}" y="${vhmY}" font-family="Arial,Helvetica,sans-serif" font-size="${vhmSize}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">VHM</text>
  <text x="${cx}" y="${crmY}" font-family="Arial,Helvetica,sans-serif" font-size="${crmSize}" font-weight="600" fill="rgba(255,255,255,0.85)" text-anchor="middle" dominant-baseline="middle">CRM</text>
</svg>`;
}

// Íconos normales (con bordes redondeados)
[192, 512].forEach(size => {
  fs.writeFileSync(path.join(outDir, `icon-${size}.svg`), makeIconSVG(size));
  console.log(`icon-${size}.svg generado`);
});

// Splash screen (cuadrado sin bordes)
fs.writeFileSync(path.join(outDir, 'splash.svg'), makeSplashSVG(512));
console.log('splash.svg generado');
