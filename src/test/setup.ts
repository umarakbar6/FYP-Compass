import { configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
// Lazy route chunks can exceed the default one-second DOM wait on slower Windows disks.
configure({ asyncUtilTimeout: 5000 });
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});
