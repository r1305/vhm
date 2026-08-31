// Genera íconos PWA usando solo módulos nativos de Node
// Ejecutar: node generate-icons.js
const fs = require('fs');
const path = require('path');

function makePNG(size) {
  // PNG mínimo válido con fondo morado y letra H blanca usando raw PNG chunks
  // Usamos una imagen SVG embebida como data URL y la convertimos con sharp si está disponible,
  // o generamos un PNG sólido de color como fallback.
  try {
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Fondo
    ctx.fillStyle = '#7c3aed';
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, size * 0.2);
    ctx.fill();

    // Ícono de corazón con pulso
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${size * 0.45}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('V', size / 2, size / 2);

    return canvas.toBuffer('image/png');
  } catch {
    // Fallback: PNG 1x1 morado si no hay canvas
    return Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
      '2e00000000c4944415478016360f8cfc00000000200016b0017e0000000049454e44ae426082', 'hex'
    );
  }
}

const outDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

[192, 512].forEach(size => {
  const buf = makePNG(size);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), buf);
  console.log(`icon-${size}.png generado`);
});
