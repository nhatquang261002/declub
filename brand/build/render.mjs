// Rasterises the brand kit's SVGs to PNG. Run from web/ so `sharp` resolves:
//   cd web && node ../brand/build/render.mjs
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// ES imports resolve from this file's folder; `sharp` lives in web/node_modules, so resolve it from the cwd.
const sharp = createRequire(path.join(process.cwd(), "package.json"))("sharp");

const brand = path.resolve(import.meta.dirname, "..");

// [source svg, output png, width in px, background]. Height follows the artwork's aspect ratio. Cream-on-dark
// artwork gets the Night background, because transparent it would vanish on a white page.
const JOBS = [
  ["logo/mark.svg", "png/mark-512.png", 512],
  ["logo/mark.svg", "png/mark-1024.png", 1024],
  ["logo/mark-ink.svg", "png/mark-ink-512.png", 512],
  ["logo/logo-on-dark.svg", "png/logo-on-dark-1200.png", 1200, "#171a22"],
  ["logo/logo-on-light.svg", "png/logo-on-light-1200.png", 1200],
  ["social/src/avatar.svg", "social/avatar-400.png", 400],
  ["social/src/x-header.svg", "social/x-header-1500x500.png", 1500],
  ["social/src/link-preview.svg", "social/link-preview-1200x630.png", 1200],
];

for (const [src, out, width, background] of JOBS) {
  const svg = await readFile(path.join(brand, src));
  // Render at 2x the viewBox density, then size down, so edges stay crisp.
  let img = sharp(svg, { density: 384 }).resize({ width });
  if (background) img = img.flatten({ background });
  const png = await img.png({ compressionLevel: 9 }).toBuffer();
  const dest = path.join(brand, out);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, png);
  console.log(out);
}
