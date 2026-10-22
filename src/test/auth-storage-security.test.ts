import { tabAuthStorage } from '../security/auth-storage';
const key = 'sb-owned-project-auth-token';
it('migrates only this project auth state from persistent storage to the current tab', () => {
  localStorage.setItem(key, 'synthetic-session');
  localStorage.setItem(key + '-code-verifier', 'synthetic-verifier');
  localStorage.setItem('another-project-auth', 'untouched');
  const storage = tabAuthStorage(sessionStorage, localStorage, key);
  expect(storage.getItem(key)).toBe('synthetic-session');
  expect(storage.getItem(key + '-code-verifier')).toBe('synthetic-verifier');
  expect(localStorage.getItem(key)).toBeNull();
  expect(localStorage.getItem('another-project-auth')).toBe('untouched');
});
it('preserves the existing tab account instead of replacing it with an older stored account', () => {
  sessionStorage.setItem(key, 'current-tab');
  localStorage.setItem(key, 'old-browser');
  const storage = tabAuthStorage(sessionStorage, localStorage, key);
  expect(storage.getItem(key)).toBe('current-tab');
  expect(localStorage.getItem(key)).toBeNull();
});
it('works in blocked storage without persisting credentials elsewhere and clears on signout', () => {
  const blocked = {
    getItem() {
      throw Error('blocked');
    },
    setItem() {
      throw Error('blocked');
    },
    removeItem() {
      throw Error('blocked');
    },
  };
  const storage = tabAuthStorage(blocked, blocked, key);
  storage.setItem(key, 'synthetic-session');
  expect(storage.getItem(key)).toBe('synthetic-session');
  expect(localStorage.length).toBe(0);
  storage.removeItem(key);
  expect(storage.getItem(key)).toBeNull();
});
