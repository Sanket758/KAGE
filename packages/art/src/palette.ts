/**
 * KAGE's limited palette: deep navy shadow, cyan bioluminescence,
 * amber warnings, muted violet rest states.
 * Index 0 is transparent; every other entry is an opaque hex color.
 */
export const PALETTE: ReadonlyArray<string | null> = [
  null, // 0 transparent
  "#05070d", // 1 outline
  "#0a1120", // 2 shade
  "#101a30", // 3 body
  "#182743", // 4 body light
  "#2b4670", // 5 rim
  "#8ffff0", // 6 eye glow
  "#3fe0c8", // 7 eye
  "#1a7f78", // 8 eye dim
  "#ffb45c", // 9 amber
  "#a8641f", // 10 amber dim
  "#8b83e8", // 11 violet
  "#e8feff", // 12 white
  "#3b4a63", // 13 mist
  "#161327", // 14 shadow body (disconnected)
  "#3a3160", // 15 shadow rim (disconnected)
] as const;

export const TRANSPARENT = 0;

export const COLORS = {
  outline: 1,
  shade: 2,
  body: 3,
  bodyLight: 4,
  rim: 5,
  eyeGlow: 6,
  eye: 7,
  eyeDim: 8,
  amber: 9,
  amberDim: 10,
  violet: 11,
  white: 12,
  mist: 13,
  shadowBody: 14,
  shadowRim: 15,
} as const;

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

export const PALETTE_RGB: ReadonlyArray<[number, number, number] | null> = PALETTE.map((hex) =>
  hex === null ? null : hexToRgb(hex),
);
