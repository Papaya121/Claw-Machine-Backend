export function getEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getEnvBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  return raw === '1' || raw.toLowerCase() === 'true';
}

export function getEnvString(name: string, fallback: string): string {
  return process.env[name] || fallback;
}
