if (typeof globalThis.window === 'undefined') {
  const dummyDoc = {
    createElement: () => ({ style: {} }),
    documentElement: { style: {} },
  };
  const dummyWindow = {
    screen: {},
    document: dummyDoc,
    navigator: globalThis.navigator ?? { userAgent: 'node' },
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  };
  (globalThis as unknown as { window: typeof dummyWindow }).window = dummyWindow;
  (globalThis as unknown as { document: typeof dummyDoc }).document = dummyDoc;
}
