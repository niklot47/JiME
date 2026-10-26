// Touch input for the NGUI screens. Their lists (save slots, rest page, game menu, campaign texts) scroll by the
// mouse wheel (.ngui-wheel areas with onWheel): a vertical swipe there sends the same wheel events, one step per
// STEP pixels of finger travel. A swipe is not a tap: the click that follows it is swallowed.

const STEP = 36;
/** finger travel (CSS px) after which the touch is a swipe, not a tap */
const SLOP = 10;

export function installTouchScroll(): void {
  let cur: { id: number; el: Element; x0: number; y0: number; y: number; acc: number; swipe: boolean } | null = null;

  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    const el = (e.target as Element | null)?.closest?.(".ngui-wheel");
    cur = el ? { id: e.pointerId, el, x0: e.clientX, y0: e.clientY, y: e.clientY, acc: 0, swipe: false } : null;
  }, { capture: true, passive: true });

  document.addEventListener("pointermove", (e) => {
    if (!cur || e.pointerId !== cur.id) return;
    if (!cur.swipe && Math.hypot(e.clientX - cur.x0, e.clientY - cur.y0) > SLOP) cur.swipe = true;
    cur.acc += e.clientY - cur.y;
    cur.y = e.clientY;
    // finger up = content up = the wheel turned down (deltaY > 0)
    while (cur.acc <= -STEP) { wheel(cur.el, 100); cur.acc += STEP; }
    while (cur.acc >= STEP) { wheel(cur.el, -100); cur.acc -= STEP; }
  }, { capture: true, passive: true });

  const end = (e: PointerEvent) => {
    if (!cur || e.pointerId !== cur.id) return;
    if (cur.swipe) swallowNextClick();
    cur = null;
  };
  document.addEventListener("pointerup", end, { capture: true, passive: true });
  document.addEventListener("pointercancel", end, { capture: true, passive: true });
}

function wheel(el: Element, deltaY: number): void {
  el.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
}

function swallowNextClick(): void {
  const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); done(); };
  const done = () => { window.removeEventListener("click", stop, true); clearTimeout(t); };
  window.addEventListener("click", stop, true);
  // no click came (the finger left the element): forget it
  const t = setTimeout(done, 400);
}
