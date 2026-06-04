export function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

export function avatarStyle(id: string): { background: string; color: string } {
  const hue = hueFromId(id);
  return {
    background: `hsl(${hue} 45% 28%)`,
    color: `hsl(${hue} 30% 92%)`,
  };
}
