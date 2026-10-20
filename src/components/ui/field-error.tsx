/** A field's message from the last save, tied to its input by id (the input sets aria-describedby to it). */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <small id={id} className="text-[0.78rem] text-bad">
      {message}
    </small>
  );
}
