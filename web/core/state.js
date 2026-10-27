/* Shared mutable context. `run` is the open run view ({id, S}); openAgent/openQuery are set by core/ui.js
 * so dom.js can link avatars without a circular import at load time. */
export const current = { run: null, openAgent: null, openQuery: null };

/** Tiny event bus: on(type | '*', fn) -> off */
export function createBus() {
  const subs = new Map();
  return {
    on(type, fn) { (subs.get(type) || subs.set(type, new Set()).get(type)).add(fn); return () => subs.get(type)?.delete(fn); },
    emit(type, payload) {
      for (const fn of subs.get(type) || []) { try { fn(payload); } catch (e) { console.error(`bus ${type} handler failed`, e); } }
      for (const fn of subs.get('*') || []) { try { fn(type, payload); } catch (e) { console.error('bus * handler failed', e); } }
    },
    clear() { subs.clear(); },
  };
}
