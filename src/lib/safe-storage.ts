// Storage that never throws: a full or blocked browser store just means things aren't kept past this page.
export const safeStorage = {
  getItem: (name: string) => { try { return localStorage.getItem(name); } catch { return null; } },
  setItem: (name: string, value: string) => { try { localStorage.setItem(name, value); } catch { /* not kept */ } },
  removeItem: (name: string) => { try { localStorage.removeItem(name); } catch { /* nothing to remove */ } },
};
