/**
 * A light, universal acknowledgement for enabled controls in the BeanBook app.
 * It runs at capture time so quick navigations and state changes still respond.
 * No application action is intercepted; success/failure remains with each workflow.
 */
const feedbackSelector = 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]';

export function installButtonFeedback(): () => void {
  const pending = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

  function indicate(target: EventTarget | null) {
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>(feedbackSelector);
    if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;

    const previous = pending.get(button);
    if (previous) clearTimeout(previous);
    button.classList.remove('bb-click-feedback');
    // Restart the acknowledgement when the same control is tapped repeatedly.
    void button.offsetWidth;
    button.classList.add('bb-click-feedback');
    pending.set(button, setTimeout(() => {
      button.classList.remove('bb-click-feedback');
      pending.delete(button);
    }, 320));
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 0) indicate(event.target);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) indicate(event.target);
  };

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  };
}
