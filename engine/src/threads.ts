// Thread charts (.tch / .clr) and colour matching.
// Chart lines are comma-separated: code, brand, name, (unused), R, G, B.

export interface Thread {
  code: string;
  brand: string;
  name: string;
  rgb: [number, number, number];
}

export function parseThreadChart(text: string): Thread[] {
  const threads: Thread[] = [];
  for (const line of text.split(/\r?\n/)) {
    const f = line.split(',');
    if (f.length < 7) continue;
    const rgb = [f[4], f[5], f[6]].map((v) => Number.parseInt(v ?? '', 10));
    if (rgb.some((v) => !Number.isFinite(v))) continue;
    threads.push({
      code: f[0]!.trim(),
      brand: f[1]!.trim(),
      name: f[2]!.trim(),
      rgb: rgb as [number, number, number],
    });
  }
  return threads;
}
