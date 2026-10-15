// Runtime observation only: do not probe apps, connect browsers, or infer remote OS from the host.
export function contextFromTarget(target, surfaces) {
  if (typeof surfaces !== 'string') return null;
  const enabled = new Set(surfaces.split(',').map(s => s.trim()).filter(Boolean));
  if ([...enabled].some(s => !['computer', 'browser'].includes(s))) return null;
  const platform = ({mac:'darwin', linux:'linux', windows:'win32'})[target] ?? null;
  if (enabled.has('computer') && !platform) return null;
  return {platform: enabled.has('computer') ? platform : null,
    computer: enabled.has('computer'), browser: enabled.has('browser')};
}

export function runtimeContext(cua, surfaces) {
  let target;
  try { target = cua?.computer?.target; } catch { return null; }
  const c = contextFromTarget(target, surfaces);
  if (!c) return null;
  // Bootstrap installs these methods only after their provider is initialized.
  if (c.computer && (typeof cua?.getApp !== 'function' || typeof cua?.listApps !== 'function')) return null;
  if (c.browser && (typeof cua?.getBrowser !== 'function' || typeof cua?.getTab !== 'function')) return null;
  return c;
}

export function attachAdaptiveDocs(cua, {surfaces, emitDetail}) {
  const emitted = new Set();
  const pending = new Map();
  const context = () => runtimeContext(cua, surfaces());
  // This observes existing bindings only; it never calls discovery or UI methods.
  const signature = c => JSON.stringify(c);
  const wrap = (name, topic) => {
    if (typeof cua[name] !== 'function') return;
    const original = cua[name];
    cua[name] = async function(...args) {
      const c = context();
      const key = `${topic}:${signature(c)}`;
      if (c && c[topic === 'native' ? 'computer' : 'browser'] && !emitted.has(key)) {
        if (!pending.has(key)) {
          pending.set(key, Promise.resolve().then(() => emitDetail(topic,c)).then(() => {
            emitted.add(key);
          }).finally(() => pending.delete(key)));
        }
        // Documentation failure happens before binding, never after a possible
        // app launch/tab creation that the caller could mistakenly replay.
        await pending.get(key);
      }
      return Reflect.apply(original, this, args);
    };
  };
  wrap('getApp', 'native');
  for (const name of ['getBrowser','getTab','createBrowserTab']) wrap(name, 'browser');
  if (typeof cua.rewriteDocumentation === 'function') {
    const original = cua.rewriteDocumentation;
    cua.rewriteDocumentation = async function(...args) {
      const result = await Reflect.apply(original, this, args);
      const used = new Set([...emitted].map(key => key.split(':')[0]));
      emitted.clear();
      const c = context();
      // Existing bindings may be used directly after compaction. Re-emit previously used
      // references here, without touching those bindings or observing the UI.
      if (c) for (const topic of used) {
        if (c[topic === 'native' ? 'computer' : 'browser']) {
          await emitDetail(topic, c);
          emitted.add(`${topic}:${signature(c)}`);
        }
      }
      return result;
    };
  }
  return context;
}
