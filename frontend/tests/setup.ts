// Vitest 글로벌 셋업 — jsdom 환경에서 testing-library matchers 활성화
import '@testing-library/jest-dom/vitest';

// Mock localStorage (이미 jsdom이 제공하지만 명시적으로 셋팅)
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('userId', 'test-user');
});
