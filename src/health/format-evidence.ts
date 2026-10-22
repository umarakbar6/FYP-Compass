export function formatHealthEvidence(text: string): string {
  return text.replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g,
    (value) => {
      const date = new Date(value);
      return Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
            date,
          )
        : value;
    },
  );
}
