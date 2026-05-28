// 앱 루트 컴포넌트 — 라우팅
import { Link, Route, Routes } from 'react-router-dom';
import { AssetList } from './pages/AssetList';
import { MyRentals } from './pages/MyRentals';
import { ReturnExtend } from './pages/ReturnExtend';

export function App() {
  const userId = localStorage.getItem('userId');
  return (
    <div style={{ fontFamily: 'sans-serif', padding: 24, maxWidth: 880, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>사내 장비 대여</h1>
        <small>{userId}</small>
      </header>
      <nav style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <Link to="/">장비 목록</Link>
        <Link to="/mine">내 대여</Link>
        <Link to="/return-extend">반납/연장</Link>
      </nav>
      <Routes>
        <Route path="/" element={<AssetList />} />
        <Route path="/mine" element={<MyRentals />} />
        <Route path="/return-extend" element={<ReturnExtend />} />
      </Routes>
    </div>
  );
}
