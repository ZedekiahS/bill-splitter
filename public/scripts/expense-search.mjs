// Preserve the input node and let IMEs finish composing before filtering results.
export function bindExpenseSearch(input, onSearch) {
  let composing = false;
  let lastValue = input.value;
  const update = () => {
    if (composing || input.value === lastValue) return;
    lastValue = input.value;
    onSearch(lastValue);
  };
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; update(); });
  input.addEventListener('input', event => { if (!event.isComposing) update(); });
  input.addEventListener('search', update);
}
