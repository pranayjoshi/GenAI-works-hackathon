(() => {
  const path = (el) => { const p = []; for (let e = el; e && e.id !== 'view' && p.length < 4; e = e.parentElement) p.unshift(e.tagName.toLowerCase() + (e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : '')); return p.join(' > '); };
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0' && !el.closest('[hidden]'); };
  const out = { pageOverflow: document.documentElement.scrollWidth - innerWidth, spill: [], clipped: [], hscroll: [] };
  const root = document.querySelector('#view');
  const boxes = [...root.querySelectorAll('.card, [class*="-card"], [class*="-panel"], .ws-pane, .ws-dock, .ws-phases, .view-page, .modal-card, .drawer')].filter(vis);
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el) || el instanceof SVGElement && el.tagName !== 'svg') continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'absolute' && el.closest('svg')) continue;
    // spill: sticks out of the nearest container box by >2px horizontally
    const box = boxes.filter((b) => b !== el && b.contains(el)).pop();
    if (box) {
      const b = box.getBoundingClientRect();
      const bcs = getComputedStyle(box);
      if (bcs.overflowX === 'visible' && (r.right > b.right + 2 || r.left < b.left - 2) && r.width < innerWidth) out.spill.push(`${path(el)}  ⟶ out of ${path(box).split(' > ').pop()} by ${Math.round(Math.max(r.right - b.right, b.left - r.left))}px`);
    }
    // text clipped by overflow hidden without ellipsis/line-clamp
    if ((cs.overflow.includes('hidden') || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && !cs.webkitLineClamp?.match(/\d/) && el.children.length < 3 && el.textContent.trim().length > 2)
      out.clipped.push(`${path(el)} (${el.scrollWidth}>${el.clientWidth}) "${el.textContent.trim().slice(0, 40)}"`);
    // unexpected horizontal scrollbars
    if (['auto', 'scroll'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && !el.classList.contains('tbl-wrap')) out.hscroll.push(`${path(el)} (${el.scrollWidth}>${el.clientWidth})`);
  }
  const dedupe = (a) => [...new Set(a)].slice(0, 25);
  out.spill = dedupe(out.spill); out.clipped = dedupe(out.clipped); out.hscroll = dedupe(out.hscroll);
  return out;
})()
