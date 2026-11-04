export function isComposingEvent(event) {
  return Boolean(event?.isComposing || event?.keyCode === 229);
}
