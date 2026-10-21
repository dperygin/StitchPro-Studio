// Loads every thread chart in src/threads/ (.tch, plus .clr which uses the same layout).

import { parseThreadChart, type Thread } from '@stitchpro/engine';

export interface ThreadChart {
  name: string;
  threads: Thread[];
}

const files = import.meta.glob<string>('./threads/*.{tch,clr}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const threadCharts: ThreadChart[] = Object.entries(files)
  .map(([path, text]) => ({
    name: path.replace(/^.*\//, '').replace(/\.(tch|clr)$/i, ''),
    threads: parseThreadChart(text),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
