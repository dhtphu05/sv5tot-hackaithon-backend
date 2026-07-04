import { smartReaderConfig } from './smartreader.config';
import { SmartReaderClient } from './smartreader.client';
import { MockSmartReaderAdapter } from './smartreader.mock';
import type { SmartReaderAdapter } from './smartreader.types';

let adapter: SmartReaderAdapter | undefined;

export function createSmartReaderAdapter(): SmartReaderAdapter {
  if (!smartReaderConfig.enabled) {
    return new MockSmartReaderAdapter();
  }
  return new SmartReaderClient(smartReaderConfig);
}

export function getSmartReaderAdapter(): SmartReaderAdapter {
  adapter ??= createSmartReaderAdapter();
  return adapter;
}
