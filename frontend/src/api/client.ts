// 백엔드 API 호출 클라이언트 + 표시용 가공 헬퍼
const BASE = 'http://localhost:8000';

function authHeaders(): Record<string, string> {
  const userId = localStorage.getItem('userId') ?? '';
  return userId ? { 'X-User-Id': userId } : {};
}

export interface Asset {
  id: number;
  name: string;
  asset_type: string;
  status: string;
}

export interface Rental {
  id: number;
  asset_id: number;
  user_id: string;
  started_at: string;
  due_at: string;
  returned_at: string | null;
}

async function handleError(res: Response, label: string): Promise<never> {
  const bodyText = await res.text().catch(() => '');
  console.error(`[api] ${label} failed`, {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    url: res.url,
    body: bodyText,
    userId: localStorage.getItem('userId'),
  });
  let detail: unknown = bodyText;
  try {
    detail = JSON.parse(bodyText).detail;
  } catch {
    /* keep raw */
  }
  throw new Error(`${label}: ${String(detail)}`);
}

export async function fetchAssets(): Promise<Asset[]> {
  const res = await fetch(`${BASE}/assets`);
  if (!res.ok) await handleError(res, 'fetchAssets');
  const all: Asset[] = await res.json();
  return all
    .filter((asset) => asset.status !== 'retired')
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export async function fetchActiveAssetsForUser(): Promise<Asset[]> {
  const userId = localStorage.getItem('userId') ?? '';
  const all = await fetchAssets();
  if (!userId) return all;
  const mine = await fetchMyRentals();
  const activeAssetIds = new Set(mine.filter((r) => r.returned_at === null).map((r) => r.asset_id));
  return all.filter((asset) => !activeAssetIds.has(asset.id) || asset.status === 'available');
}

export async function fetchMyRentals(): Promise<Rental[]> {
  const res = await fetch(`${BASE}/rentals/mine`, { headers: authHeaders() });
  if (!res.ok) await handleError(res, 'fetchMyRentals');
  return res.json();
}

export async function createRental(assetId: number): Promise<Rental> {
  const res = await fetch(`${BASE}/rentals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ asset_id: assetId }),
  });
  if (!res.ok) await handleError(res, 'createRental');
  return res.json();
}
