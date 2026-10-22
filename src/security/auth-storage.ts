interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}
// Keep auth identity and refresh tokens out of persistent localStorage on shared devices.
// Session storage is still readable by same-origin JavaScript; CSP and server checks remain necessary.
export function tabAuthStorage(
  tab?: StorageLike,
  legacy?: StorageLike,
  authKey?: string,
): StorageLike {
  const memory = new Map<string, string>();
  const storage: StorageLike = {
    getItem(key) {
      try {
        return tab?.getItem(key) ?? memory.get(key) ?? null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      memory.set(key, value);
      try {
        tab?.setItem(key, value);
      } catch {
        /* Memory only; never fall back to localStorage. */
      }
    },
    removeItem(key) {
      memory.delete(key);
      try {
        tab?.removeItem(key);
      } catch {
        /* Storage may be blocked. */
      }
    },
  };
  if (legacy && authKey)
    for (const key of [authKey, authKey + '-code-verifier', authKey + '-user']) {
      try {
        const value = legacy.getItem(key);
        if (value && value.length <= 65536 && !storage.getItem(key)) storage.setItem(key, value);
        legacy.removeItem(key);
      } catch {
        /* A blocked legacy storage area is not used for authentication. */
      }
    }
  return storage;
}
export function browserAuthStorage(authKey: string) {
  let tab: StorageLike | undefined;
  let legacy: StorageLike | undefined;
  try {
    tab = window.sessionStorage;
  } catch {
    /* Privacy mode: memory only. */
  }
  try {
    legacy = window.localStorage;
  } catch {
    /* Privacy mode: no legacy data. */
  }
  return tabAuthStorage(tab, legacy, authKey);
}
