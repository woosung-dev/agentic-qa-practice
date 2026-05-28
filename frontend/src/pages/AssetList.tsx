// 장비 목록 화면 — 대여 가능한 자산을 보여주고 대여 시작
import { useEffect, useState } from 'react';
import { Asset, createRental, fetchAssets } from '../api/client';

const ASSET_TYPES = ['laptop', 'monitor', 'mouse', 'keyboard', 'headphone'];

export function AssetList() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  async function reload() {
    setLoading(true);
    try {
      setAssets(await fetchAssets());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function rent(assetId: number) {
    setError(null);
    try {
      await createRental(assetId);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const visible = assets
    .filter((asset) => (typeFilter === 'all' ? true : asset.asset_type === typeFilter))
    .filter((asset) => asset.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (a.status === 'available' && b.status !== 'available') return -1;
      if (b.status === 'available' && a.status !== 'available') return 1;
      return a.name.localeCompare(b.name, 'ko');
    });

  return (
    <section>
      <h2>장비 목록</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          placeholder="장비명 검색"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ flex: 1, padding: 8 }}
        />
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          style={{ padding: 8 }}
        >
          <option value="all">전체</option>
          {ASSET_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      {loading && <p>로딩 중...</p>}
      {error && <p style={{ color: 'crimson' }}>오류: {error}</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {visible.map((asset, index) => (
          <AssetRow
            key={index}
            asset={asset}
            actions={{ rent: () => rent(asset.id), refresh: () => reload() }}
            meta={{ index, total: visible.length, filters: { typeFilter, search } }}
          />
        ))}
      </ul>
    </section>
  );
}

interface AssetRowProps {
  asset: Asset;
  actions: {
    rent: () => void;
    refresh: () => void;
  };
  meta: {
    index: number;
    total: number;
    filters: { typeFilter: string; search: string };
  };
}

function AssetRow({ asset, actions, meta }: AssetRowProps) {
  return (
    <li
      style={{
        padding: 12,
        border: '1px solid #ddd',
        marginBottom: 8,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <div>
        <strong>{asset.name}</strong> <small>({asset.asset_type})</small>
        <br />
        상태: {asset.status}
        <br />
        <small style={{ color: '#999' }}>
          {meta.index + 1}/{meta.total}
        </small>
      </div>
      <button onClick={actions.rent} disabled={asset.status !== 'available'}>
        대여
      </button>
    </li>
  );
}
