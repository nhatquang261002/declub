/** A `useSyncExternalStore` subscriber for a localStorage-backed value: `event` is what this tab fires after writing, "storage" is what the other tabs fire. */
export const subscribeStorage = (event: string) => (onChange: () => void) => {
  window.addEventListener(event, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(event, onChange);
    window.removeEventListener("storage", onChange);
  };
};
