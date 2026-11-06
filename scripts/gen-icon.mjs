import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'electron', 'assets')
mkdirSync(outDir, { recursive: true })

const GREEN = [47, 107, 79, 255]
const WHITE = [255, 255, 255, 255]
const CLEAR = [0, 0, 0, 0]

function roundedRectInside(x, y, w, h, r) {
  if (x < r && y < r) return (r - x) ** 2 + (r - y) ** 2 <= r * r
  if (x > w - r && y < r) return (x - (w - r)) ** 2 + (r - y) ** 2 <= r * r
  if (x < r && y > h - r) return (r - x) ** 2 + (y - (h - r)) ** 2 <= r * r
  if (x > w - r && y > h - r) return (x - (w - r)) ** 2 + (y - (h - r)) ** 2 <= r * r
  return x >= 0 && x < w && y >= 0 && y < h
}

function render(size, supersample = 4) {
  const S = size * supersample
  const canvas = new Uint8ClampedArray(S * S * 4)
  const radius = S * 0.24
  const bars = [
    { y0: 0.3, x1: 0.7 },
    { y0: 0.47, x1: 0.7 },
    { y0: 0.64, x1: 0.56 },
  ].map((b) => ({
    y0: Math.round(S * b.y0),
    y1: Math.round(S * b.y0 + S * 0.085),
    x0: Math.round(S * 0.3),
    x1: Math.round(S * b.x1),
  }))

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4
      let color = CLEAR
      if (roundedRectInside(x, y, S, S, radius)) {
        color = GREEN
        for (const b of bars) {
          if (y >= b.y0 && y < b.y1 && x >= b.x0 && x < b.x1) color = WHITE
        }
      }
      canvas[i] = color[0]
      canvas[i + 1] = color[1]
      canvas[i + 2] = color[2]
      canvas[i + 3] = color[3]
    }
  }

  // 降采样，边缘才不会锯齿
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < supersample; sy++) {
        for (let sx = 0; sx < supersample; sx++) {
          const i = ((y * supersample + sy) * S + (x * supersample + sx)) * 4
          r += canvas[i]
          g += canvas[i + 1]
          b += canvas[i + 2]
          a += canvas[i + 3]
        }
      }
      const n = supersample * supersample
      const o = (y * size + x) * 4
      out[o] = Math.round(r / n)
      out[o + 1] = Math.round(g / n)
      out[o + 2] = Math.round(b / n)
      out[o + 3] = Math.round(a / n)
    }
  }
  return out
}

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [16, 32, 64, 256, 512]) {
  const png = encodePng(render(size), size)
  const name = size === 256 ? 'icon.png' : `icon-${size}.png`
  writeFileSync(join(outDir, name), png)
}

// 安卓图标源：@capacitor/assets 要求 1024x1024，放在项目根的 assets/ 下。
// 图标本来就是程序画的，按 1024 重画比放大 512 更清晰。
const androidAssetDir = join(here, '..', 'assets')
mkdirSync(androidAssetDir, { recursive: true })
writeFileSync(join(androidAssetDir, 'icon.png'), encodePng(render(1024), 1024))

console.log('图标已生成:', outDir, '和', androidAssetDir)
