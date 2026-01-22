const icons = [
  "🐼", "🐯", "🦊", "🐺", "🦁", "🐸", "🐵", "🐧", "🦉", "🐙",
  "🍎", "🍐", "🍋", "🍇", "🍉", "🍑", "🍒", "🥝", "🍍", "🍌",
];

export function pickSessionIcon(sessionId: string, usedIcons: string[]): string {
  const h = hash32(sessionId);
  for (let i = 0; i < icons.length; i++) {
    const icon = icons[(h + i) % icons.length];
    if (!usedIcons.includes(icon)) return icon;
  }
  return icons[h % icons.length];
}

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
