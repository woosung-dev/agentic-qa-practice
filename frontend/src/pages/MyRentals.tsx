// 내 대여 화면 — 사용자의 활성/완료 대여 목록을 보여줌
import { useEffect, useState } from 'react';
import { Rental, fetchMyRentals } from '../api/client';

type Filter = 'all' | 'active' | 'returned';

export function MyRentals() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    fetchMyRentals()
      .then((all) => {
        if (filter === 'active') {
          setRentals(all.filter((r) => r.returned_at === null));
        } else if (filter === 'returned') {
          setRentals(all.filter((r) => r.returned_at !== null));
        } else {
          setRentals(all);
        }
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <p style={{ color: 'crimson' }}>오류: {error}</p>;

  return (
    <section>
      <h2>내 대여</h2>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <button onClick={() => setFilter('all')}>전체</button>
        <button onClick={() => setFilter('active')}>대여 중</button>
        <button onClick={() => setFilter('returned')}>반납 완료</button>
      </div>
      {rentals.length === 0 ? (
        <p>대여 중인 장비가 없습니다.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={cell}>장비 ID</th>
              <th style={cell}>대여 시작</th>
              <th style={cell}>반납 예정</th>
              <th style={cell}>상태</th>
            </tr>
          </thead>
          <tbody>
            {rentals.map((rental) => (
              <tr key={rental.id}>
                <td style={cell}>{rental.asset_id}</td>
                <td style={cell}>{new Date(rental.started_at).toLocaleString()}</td>
                <td style={cell}>{new Date(rental.due_at).toLocaleString()}</td>
                <td style={cell}>{rental.returned_at ? '반납 완료' : '대여 중'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const cell: React.CSSProperties = {
  padding: 8,
  borderBottom: '1px solid #eee',
  textAlign: 'left',
};
