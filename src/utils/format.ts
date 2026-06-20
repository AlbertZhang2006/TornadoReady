export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function efScaleLabel(ef: number): string {
  return `EF${ef}`;
}

