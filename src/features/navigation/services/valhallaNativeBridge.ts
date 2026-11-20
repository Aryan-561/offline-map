import ValhallaEngine from '@modules/valhalla-engine';

import { registerNativeValhallaBridge } from './localValhallaAdapter';

if (ValhallaEngine) {
  const engine = ValhallaEngine;

  registerNativeValhallaBridge({
    initialize(options) {
      return engine.initialize(options);
    },
    async route(request) {
      const raw = await engine.route(
        request as unknown as Record<string, unknown>,
      );
      return JSON.parse(raw);
    },
    isInitialized() {
      return engine.isInitialized();
    },
    dispose() {
      return engine.dispose();
    },
  });
}
