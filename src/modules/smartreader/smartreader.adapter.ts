import { smartReaderConfig } from './smartreader.config';
import { SmartReaderClient } from './smartreader.client';
import { MockSmartReaderAdapterForTests } from './smartreader.mock';
import { SmartReaderConfigError } from './smartreader.errors';
import type { SmartReaderAdapter } from './smartreader.types';

let adapter: SmartReaderAdapter | undefined;

export function createSmartReaderAdapter(): SmartReaderAdapter {
  if (!smartReaderConfig.enabled) {
    if (smartReaderConfig.allowMockRuntime && !smartReaderConfig.requireRealInPipeline) {
      return new MockSmartReaderAdapterForTests();
    }
    throw new SmartReaderConfigError(
      'VNPT SmartReader runtime is disabled, but Evidence OCR pipeline requires real VNPT',
      {
        VNPT_ENABLED: smartReaderConfig.enabled,
        VNPT_REQUIRE_REAL_IN_PIPELINE: smartReaderConfig.requireRealInPipeline,
        VNPT_ALLOW_MOCK_RUNTIME: smartReaderConfig.allowMockRuntime,
      },
    );
  }
  return new SmartReaderClient(smartReaderConfig);
}

export function getSmartReaderAdapter(): SmartReaderAdapter {
  adapter ??= createSmartReaderAdapter();
  return adapter;
}
