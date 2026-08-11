import type { OiRecord } from '@/lib/domain/types';

export type OiAircraft = OiRecord['aircraft'];

export type OiSearchStatus = 'empty' | 'single' | 'ambiguous' | 'not_found';

export type OiSearchItem = OiRecord & {
  documentUrlValid: boolean;
};

export type OiSearchResponse =
  | { ok: true; status: OiSearchStatus; aircraft: OiAircraft; query: string; items: OiSearchItem[] }
  | { ok: false; reason: 'UNAUTHORIZED' | 'INVALID_INPUT' | 'INTERNAL_ERROR'; aircraft?: OiAircraft; query?: string; items: [] };

export type OiRepository = {
  listActiveOis(): Promise<OiRecord[]>;
};
