/** The small ring that says "working". It takes its colour from the text around it. */
export function Spinner() {
  return (
    <span
      aria-hidden
      className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-pulse"
    />
  );
}
