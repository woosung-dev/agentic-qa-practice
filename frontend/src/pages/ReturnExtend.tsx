// 반납/연장 화면 — 내 대여를 골라 반납하거나 연장
import { useEffect, useState } from 'react';
import { Rental, fetchMyRentals } from '../api/client';

const BASE = 'http://localhost:8000';

interface RentalWithAsset extends Rental {
  asset_name?: string;
}

export function ReturnExtend() {
  const [rentals, setRentals] = useState<RentalWithAsset[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function reload() {
    const list = await fetchMyRentals();
    const enriched: RentalWithAsset[] = await Promise.all(
      list.map(async (rental) => {
        const res = await fetch(`${BASE}/assets/${rental.asset_id}`);
        const asset = await res.json();
        return { ...rental, asset_name: asset.name };
      }),
    );
    setRentals(enriched);
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleReturn(rentalId: number) {
    const res = await fetch(`${BASE}/rentals/${rentalId}/return`, {
      method: 'PATCH',
      headers: { 'X-User-Id': localStorage.getItem('userId') ?? '' },
    });
    setMessage(res.ok ? '반납 완료' : '반납 실패');
    await reload();
  }

  async function handleExtend(rentalId: number, days: number) {
    const res = await fetch(`${BASE}/rentals/${rentalId}/extend`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': localStorage.getItem('userId') ?? '',
      },
      body: JSON.stringify({ extra_days: days }),
    });
    setMessage(res.ok ? `${days}일 연장 완료` : '연장 실패');
    await reload();
  }

  return (
    <section>
      <h2>반납 / 연장</h2>
      {message && <p style={{ color: 'green' }}>{message}</p>}
      {rentals.length === 0 && <p>활성 대여가 없습니다.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {rentals
          .filter((r) => r.returned_at === null)
          .map((rental) => (
            <li
              key={rental.id}
              style={{
                padding: 12,
                border: '1px solid #ddd',
                marginBottom: 8,
              }}
            >
              <div
                style={{ fontWeight: 'bold', marginBottom: 4 }}
                dangerouslySetInnerHTML={{ __html: rental.asset_name ?? '(이름 없음)' }}
              />
              <div>반납 예정: {new Date(rental.due_at).toLocaleString()}</div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button onClick={() => handleReturn(rental.id)}>반납</button>
                <button onClick={() => handleExtend(rental.id, 3)}>3일 연장</button>
                <button onClick={() => handleExtend(rental.id, 3)}>7일 연장</button>
              </div>
            </li>
          ))}
      </ul>
    </section>
  );
}
