// Renders a plain floppy-disk glyph (the universal "save" icon) at whatever
// sizes PWA installability needs. No SVG rasterizer was available in this
// environment, and pulling in a native-binding canvas lib is a lot of
// weight for one icon — pngjs is pure JS and a floppy disk is simple enough
// to describe as a few rects and a circle.
//
// Flat black silhouette on white, no shading. The glyph sits inside the
// inner ~66% safe-zone circle Android's "maskable" icon spec expects, so the
// same PNGs work as both a plain and a maskable icon without a separate
// padded version.
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')

const WHITE = [255, 255, 255]
const BLACK = [17, 17, 17]

function renderIcon(size) {
  const png = new PNG({ width: size, height: size })

  // Disk body, as fractions of the icon size — inset enough to sit inside
  // the maskable safe zone.
  const left = size * 0.22
  const right = size * 0.78
  const top = size * 0.22
  const bottom = size * 0.78
  const cornerCut = size * 0.12 // the clipped top-right corner floppies have

  const shutterLeft = size * 0.34
  const shutterRight = size * 0.66
  const shutterTop = top
  const shutterBottom = size * 0.42

  const holeCx = size * 0.5
  const holeCy = size * 0.63
  const holeR = size * 0.085

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2
      let isBlack = false

      const inBody = x >= left && x <= right && y >= top && y <= bottom
      // Clip the top-right corner: the triangle beyond the cut line.
      const pastCorner = (x - (right - cornerCut)) + (top + cornerCut - y) > 0 && x > right - cornerCut && y < top + cornerCut

      if (inBody && !pastCorner) isBlack = true

      // Metal shutter — a white notch near the top of the disk.
      if (isBlack && x >= shutterLeft && x <= shutterRight && y >= shutterTop && y <= shutterBottom) {
        isBlack = false
      }

      // Label hole, lower on the body.
      if (isBlack && Math.hypot(x - holeCx, y - holeCy) <= holeR) {
        isBlack = false
      }

      const color = isBlack ? BLACK : WHITE
      png.data[idx] = color[0]
      png.data[idx + 1] = color[1]
      png.data[idx + 2] = color[2]
      png.data[idx + 3] = 255
    }
  }
  return png
}

const outDir = path.join(__dirname, '..', 'site', 'icons')
fs.mkdirSync(outDir, { recursive: true })

const sizes = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
]

for (const [name, size] of sizes) {
  const png = renderIcon(size)
  const buf = PNG.sync.write(png)
  fs.writeFileSync(path.join(outDir, name), buf)
  console.log('wrote', name, `(${size}x${size})`)
}
