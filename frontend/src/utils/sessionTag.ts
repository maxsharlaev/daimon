// Neutral unicode icons (animals + fruits), chosen to be compact and visually distinct.
const icons = [
  "🐼", "🐯", "🦊", "🐺", "🦁", "🐸", "🐵", "🐧", "🦉", "🐙",
  "🍎", "🍐", "🍋", "🍇", "🍉", "🍑", "🍒", "🥝", "🍍", "🍌",
];

export function pickSessionIcon(sessionId: string, usedIcons: string[]): string {
  const h = hash32(sessionId);
  // Try to avoid duplicates within a profile by probing forward.
  for (let i = 0; i < icons.length; i++) {
    const icon = icons[(h + i) % icons.length];
    if (!usedIcons.includes(icon)) return icon;
  }
  // Worst case: all used, return deterministic icon.
  return icons[h % icons.length];
}

function hash32(s: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

