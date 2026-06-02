// Curated spray-paint colour palettes for assigning a colour — and the paint's
// real name — to each stencil layer.
//
// IMPORTANT: these hex values are DIGITAL APPROXIMATIONS of physical spray
// paint. The manufacturers themselves state on-screen colours are "for
// simulation only", so always check a real cap/swatch before buying. Names
// follow each brand's range so you can find the can in a shop; the exact hue
// will differ on a wall. "Basics" is a brand-neutral working palette.

export const PALETTE_DISCLAIMER =
  'Colours are digital approximations — check a physical swatch before buying.';

export const PALETTES = [
  {
    id: 'basics', label: 'Basics', colors: [
      { name: 'White', hex: '#ffffff' }, { name: 'Off-White', hex: '#f4f1ea' },
      { name: 'Cream', hex: '#f3e9c6' }, { name: 'Beige', hex: '#d9c39a' },
      { name: 'Light Grey', hex: '#c8ccd0' }, { name: 'Grey', hex: '#8a9099' },
      { name: 'Dark Grey', hex: '#4a4f57' }, { name: 'Black', hex: '#1a1a1a' },
      { name: 'Yellow', hex: '#ffd400' }, { name: 'Golden Yellow', hex: '#f7b500' },
      { name: 'Orange', hex: '#f3641f' }, { name: 'Red Orange', hex: '#ef4023' },
      { name: 'Red', hex: '#e2231a' }, { name: 'Crimson', hex: '#c2185b' },
      { name: 'Pink', hex: '#ec4f9c' }, { name: 'Magenta', hex: '#d6219b' },
      { name: 'Purple', hex: '#7b2fb5' }, { name: 'Violet', hex: '#5b2a86' },
      { name: 'Navy', hex: '#14306b' }, { name: 'Blue', hex: '#0a4fa0' },
      { name: 'Sky Blue', hex: '#2b9bd8' }, { name: 'Light Blue', hex: '#6cc4e8' },
      { name: 'Teal', hex: '#109e9e' }, { name: 'Turquoise', hex: '#1fc3b0' },
      { name: 'Mint', hex: '#7fd1a3' }, { name: 'Light Green', hex: '#6fbf3b' },
      { name: 'Green', hex: '#2e9b3f' }, { name: 'Dark Green', hex: '#1c6b2f' },
      { name: 'Olive', hex: '#7a8a32' }, { name: 'Brown', hex: '#6e4326' },
      { name: 'Tan', hex: '#b88a4f' }, { name: 'Skin', hex: '#f0c8a0' },
    ],
  },
  {
    id: 'montana-gold', label: 'Montana Gold', colors: [
      { name: 'Shock White', hex: '#ffffff' }, { name: 'Shock Black', hex: '#16181a' },
      { name: 'Marble Grey', hex: '#9aa0a6' }, { name: 'Pebbles', hex: '#c4c1b8' },
      { name: 'Shock Yellow', hex: '#ffd200' }, { name: 'Gleam Yellow', hex: '#fff04d' },
      { name: 'Cocky Orange', hex: '#f7941d' }, { name: 'Shock Orange', hex: '#f15a22' },
      { name: 'Brilliant Red', hex: '#d51e26' }, { name: 'Shock Red Light', hex: '#ee3124' },
      { name: 'Bazooka', hex: '#f04e98' }, { name: 'Shock Pink', hex: '#e6177f' },
      { name: 'Shock Pink Light', hex: '#f48fb6' }, { name: 'Shock Violet', hex: '#6a2c91' },
      { name: 'Shock Blue', hex: '#0a52a8' }, { name: 'Shock Blue Light', hex: '#2f8fd6' },
      { name: 'Glacier Blue', hex: '#bcdff1' }, { name: 'Lagoon Blue', hex: '#1b9aa6' },
      { name: 'Shock Green', hex: '#3aaa35' }, { name: 'Shock Green Light', hex: '#8cc63f' },
      { name: 'Mint Pastel', hex: '#a3d9b1' }, { name: 'Sahara Beige', hex: '#d8b878' },
      { name: 'Beach', hex: '#f2e2b3' }, { name: 'Shock Brown', hex: '#6b4226' },
    ],
  },
  {
    id: 'molotow', label: 'Molotow', colors: [
      { name: 'Signal White', hex: '#f7f7f2' }, { name: 'Signal Black', hex: '#1b1b1b' },
      { name: 'Metal Grey', hex: '#7d8285' }, { name: 'Grey Blue', hex: '#6e8aa6' },
      { name: 'Traffic Red', hex: '#cc1f1a' }, { name: 'Currant', hex: '#b3123b' },
      { name: 'Burgundy', hex: '#7a1f2b' }, { name: 'Lobster', hex: '#e8593a' },
      { name: 'Dare Orange', hex: '#f26522' }, { name: 'Apricot', hex: '#f6a35c' },
      { name: 'Piglet Pink', hex: '#f3a6c0' }, { name: 'Ceramic Pink', hex: '#f4c9d3' },
      { name: 'Violet', hex: '#6b2fa0' }, { name: 'Universes Blue', hex: '#1d3f8f' },
      { name: 'Lago Blue', hex: '#2aa6c9' }, { name: 'Petrol', hex: '#14595e' },
      { name: 'Mister Green', hex: '#2f9e44' }, { name: 'Poison Green', hex: '#7ac143' },
      { name: 'Lime', hex: '#c4d600' }, { name: 'Sahara Pastel', hex: '#e3cfa3' },
    ],
  },
  {
    id: 'mtn94', label: 'MTN 94', colors: [
      { name: 'White', hex: '#f4f4ef' }, { name: 'Black', hex: '#17191b' },
      { name: 'Squartz Grey', hex: '#9a9ea3' }, { name: 'Phantom Grey', hex: '#5b6066' },
      { name: 'Light Yellow', hex: '#ffe14d' }, { name: 'Party Yellow', hex: '#ffd21f' },
      { name: 'Mostaza Yellow', hex: '#e8a51c' }, { name: 'Valencia Orange', hex: '#f26f21' },
      { name: 'Calcutta Orange', hex: '#ee5a24' }, { name: 'Vivid Red', hex: '#d81f33' },
      { name: 'Bull Red', hex: '#9e1b32' }, { name: 'Erica Magenta', hex: '#c2247e' },
      { name: 'Fucsia Pink', hex: '#e84d9a' }, { name: 'Witch Violet', hex: '#6c3a93' },
      { name: 'Andromeda Blue', hex: '#1f2f7a' }, { name: 'Avatar Blue', hex: '#1565b0' },
      { name: 'Light Blue', hex: '#3aa0dc' }, { name: 'Bahia Blue', hex: '#16a0a6' },
      { name: 'Guacamole Green', hex: '#3aa53a' }, { name: 'Pamplona Green', hex: '#1c7a3e' },
      { name: 'UFO Green', hex: '#7bc043' }, { name: 'Mango', hex: '#f6a623' },
      { name: 'Chocolate Brown', hex: '#5a3825' }, { name: 'Unicorn Skin', hex: '#f2c9a0' },
    ],
  },
];

// Look up a paint name for an exact hex (used to label default/edited colours).
export function findPaintName(hex) {
  const h = (hex || '').toLowerCase();
  for (const p of PALETTES) for (const c of p.colors) if (c.hex.toLowerCase() === h) return c.name;
  return null;
}

function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

// Nearest real spray-paint colour to an arbitrary hex (RGB distance across the
// brand palettes, skipping the generic "Basics" set). Returns { brand, name, hex }.
export function findNearestPaint(hex) {
  const [tr, tg, tb] = hexToRgb(hex);
  let best = null, bestD = Infinity;
  for (const p of PALETTES) {
    if (p.id === 'basics') continue;
    for (const c of p.colors) {
      const [r, g, b] = hexToRgb(c.hex);
      const d = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
      if (d < bestD) { bestD = d; best = { brand: p.label, name: c.name, hex: c.hex }; }
    }
  }
  return best;
}
