import { find, forEach } from 'lodash';

import {
  UPDATE_PROMPT_DISMISSED,
  PACKS_FETCH_START,
  PACKS_FETCH_ERROR,
  PACKS_AVAILABLE,
  CUSTOM_PACKS_AVAILABLE,
  PACKS_CACHE_HIT,
  SYNC_IN_COLLECTION,
  SYNC_PACK_SPOILER,
  PacksActions,
  Pack,
  SET_PACK_DRAFT,
  SET_PACK_QUANTITY,
  SET_CARD_PRINTING_OVERRIDE,
  CardPrintingOverrides,
  AssembledDeckState,
  CONFIRM_PHYSICAL_DECK_ASSEMBLY,
  CONFIRM_MULTIPLE_PHYSICAL_DECKS_ASSEMBLY,
  DISASSEMBLE_CAMPAIGN_DECKS,
  DISASSEMBLE_PHYSICAL_DECK,
  PhysicalCollectionActions,
  PhysicalCollectionMode,
  PhysicalDeckAssemblyEntry,
  SET_DECK_PHYSICAL_TRACKING,
  SET_PHYSICAL_COLLECTION_MODE,
} from '@actions/types';

function toAssembledDeckState(entry: PhysicalDeckAssemblyEntry): AssembledDeckState {
  return {
    deckKey: entry.deckKey,
    campaignId: entry.campaignId,
    campaignName: entry.campaignName,
    investigatorCode: entry.investigatorCode,
    deckId: entry.deckId,
    deckName: entry.deckName,
    tracked: true,
    assembled: true,
    physicalSlots: { ...entry.physicalSlots },
    assembledAt: entry.assembledAt,
  };
}

interface PacksState {
  all: Pack[];
  custom?: Pack[];
  dateFetched: number | null;
  dateUpdatePrompt: number | null;
  in_collection: {
    [code: string]: boolean;
  };
  pack_quantities?: {
    [code: string]: number;
  };
  card_printing_overrides?: CardPrintingOverrides;
  physical_collection_mode?: PhysicalCollectionMode;
  assembled_decks?: {
    [deckKey: string]: AssembledDeckState | undefined;
  };
  show_spoilers: {
    [code: string]: boolean;
  };
  draft?: {
    [code: string]: boolean;
  };
  loading: boolean;
  error: string | null;
  lastModified: string | null;
  lang: string | null;
}

const DEFAULT_PACKS_STATE: PacksState = {
  all: [],
  custom: [],
  dateFetched: null,
  dateUpdatePrompt: null,
  in_collection: { core: true },
  pack_quantities: {},
  card_printing_overrides: {},
  physical_collection_mode: 'manual',
  assembled_decks: {},
  show_spoilers: {},
  loading: false,
  error: null,
  lastModified: null,
  lang: null, // defaults to 'en'
};

export default function(
  state: PacksState = DEFAULT_PACKS_STATE,
  action: PacksActions | PhysicalCollectionActions
): PacksState {
  if (action.type === UPDATE_PROMPT_DISMISSED) {
    return {
      ...state,
      dateUpdatePrompt: action.timestamp.getTime() / 1000,
    };
  }
  if (action.type === PACKS_FETCH_START) {
    return {
      ...state,
      loading: true,
      error: null,
    };
  }
  if (action.type === PACKS_FETCH_ERROR) {
    return {
      ...state,
      loading: false,
      error: action.error,
    };
  }
  if (action.type === PACKS_CACHE_HIT) {
    return {
      ...state,
      loading: false,
      dateFetched: action.timestamp.getTime() / 1000,
      dateUpdatePrompt: action.timestamp.getTime() / 1000,
    };
  }
  if (action.type === PACKS_AVAILABLE) {
    return {
      ...state,
      all: action.packs,
      lang: action.lang,
      loading: false,
      dateFetched: action.timestamp.getTime() / 1000,
      dateUpdatePrompt: action.timestamp.getTime() / 1000,
      lastModified: action.lastModified || null,
    };
  }

  if (action.type === CUSTOM_PACKS_AVAILABLE) {
    return {
      ...state,
      custom: action.packs,
    };
  }

  if (action.type === SYNC_IN_COLLECTION) {
    const new_collection = Object.assign({}, state.in_collection);
    const new_quantities = Object.assign({}, state.pack_quantities || {});
    forEach(action.updates, (value, code) => {
      if (value) {
        new_collection[code] = true;
        if (code === 'no_core') {
          new_quantities.core = 0;
        } else if (code === 'core' && (new_quantities.core || 0) < 2) {
          new_quantities.core = 2;
        }
      } else {
        delete new_collection[code];
        if (code === 'no_core') {
          new_quantities.core = new_collection.core ? 2 : 1;
        } else if (code === 'core') {
          new_quantities.core = new_collection.no_core ? 0 : 1;
        } else {
          delete new_quantities[code];
        }
      }
    });
    return {
      ...state,
      in_collection: new_collection,
      pack_quantities: new_quantities,
    };
  }

  if (action.type === SET_PACK_QUANTITY) {
    const new_collection = Object.assign({}, state.in_collection);
    const new_quantities = Object.assign({}, state.pack_quantities || {});
    const qty = Math.max(0, Math.floor(action.quantity));
    if (action.code === 'core') {
      new_quantities.core = qty;
      if (qty === 0) {
        new_collection.no_core = true;
        delete new_collection.core;
      } else if (qty === 1) {
        delete new_collection.no_core;
        delete new_collection.core;
      } else {
        delete new_collection.no_core;
        new_collection.core = true;
      }
    } else {
      if (qty <= 0) {
        delete new_collection[action.code];
        delete new_quantities[action.code];
      } else if (qty === 1) {
        new_collection[action.code] = true;
        delete new_quantities[action.code];
      } else {
        new_collection[action.code] = true;
        new_quantities[action.code] = qty;
      }
    }
    return {
      ...state,
      in_collection: new_collection,
      pack_quantities: new_quantities,
    };
  }

  if (action.type === SET_CARD_PRINTING_OVERRIDE) {
    const new_overrides: CardPrintingOverrides = Object.assign({}, state.card_printing_overrides || {});
    const cardEntry = Object.assign({}, new_overrides[action.canonicalCode] || {});
    if (action.delta === 0) {
      delete cardEntry[action.packCode];
    } else {
      cardEntry[action.packCode] = action.delta;
    }
    if (Object.keys(cardEntry).length === 0) {
      delete new_overrides[action.canonicalCode];
    } else {
      new_overrides[action.canonicalCode] = cardEntry;
    }
    return {
      ...state,
      card_printing_overrides: new_overrides,
    };
  }

  if (action.type === SYNC_PACK_SPOILER) {
    const new_spoilers = Object.assign({}, state.show_spoilers);
    forEach(action.updates, (value, code) => {
      if (value) {
        new_spoilers[code] = true;
      } else {
        delete new_spoilers[code];
      }
    });
    return {
      ...state,
      show_spoilers: new_spoilers,
    };
  }

  if (action.type === SET_PACK_DRAFT) {
    const new_draft = Object.assign({}, state.draft || {});
    if (action.code) {
      if (action.value) {
        new_draft[action.code] = true;
      } else {
        delete new_draft[action.code];
      }
    } else if (action.cycle_code) {
      const cyclePack = find(state.all, pack => pack.code === action.cycle_code);
      if (cyclePack) {
        forEach(state.all, pack => {
          if (pack.cycle_position === cyclePack.cycle_position) {
            if (action.value) {
              new_draft[pack.code] = true;
            } else {
              delete new_draft[pack.code];
            }
          }
        });
      }
    }
    return {
      ...state,
      draft: new_draft,
    };
  }

  if (action.type === SET_PHYSICAL_COLLECTION_MODE) {
    return {
      ...state,
      physical_collection_mode: action.mode,
    };
  }

  if (action.type === CONFIRM_PHYSICAL_DECK_ASSEMBLY) {
    const nextDecks = { ...(state.assembled_decks || {}) };
    nextDecks[action.deckKey] = toAssembledDeckState(action);
    return {
      ...state,
      assembled_decks: nextDecks,
    };
  }

  if (action.type === CONFIRM_MULTIPLE_PHYSICAL_DECKS_ASSEMBLY) {
    const nextDecks = { ...(state.assembled_decks || {}) };
    forEach(action.decks, entry => {
      nextDecks[entry.deckKey] = toAssembledDeckState(entry);
    });
    return {
      ...state,
      assembled_decks: nextDecks,
    };
  }

  if (action.type === DISASSEMBLE_PHYSICAL_DECK) {
    const nextDecks = { ...(state.assembled_decks || {}) };
    const existing = nextDecks[action.deckKey];
    if (existing) {
      nextDecks[action.deckKey] = {
        ...existing,
        assembled: false,
        physicalSlots: {},
      };
    }
    return {
      ...state,
      assembled_decks: nextDecks,
    };
  }

  if (action.type === SET_DECK_PHYSICAL_TRACKING) {
    const nextDecks = { ...(state.assembled_decks || {}) };
    const existing = nextDecks[action.deckKey];
    if (existing) {
      nextDecks[action.deckKey] = {
        ...existing,
        tracked: action.tracked,
        assembled: action.tracked ? existing.assembled : false,
        physicalSlots: action.tracked ? existing.physicalSlots : {},
      };
    } else if (action.deckId && action.investigatorCode) {
      nextDecks[action.deckKey] = {
        deckKey: action.deckKey,
        campaignId: action.campaignId,
        investigatorCode: action.investigatorCode,
        deckId: action.deckId,
        tracked: action.tracked,
        assembled: false,
        physicalSlots: {},
        assembledAt: new Date(0).toISOString(),
      };
    }
    return {
      ...state,
      assembled_decks: nextDecks,
    };
  }

  if (action.type === DISASSEMBLE_CAMPAIGN_DECKS) {
    const nextDecks = { ...(state.assembled_decks || {}) };
    forEach(nextDecks, (deckState, key) => {
      if (deckState && deckState.campaignId?.campaignId === action.campaignId.campaignId) {
        nextDecks[key] = {
          ...deckState,
          assembled: false,
          physicalSlots: {},
        };
      }
    });
    return {
      ...state,
      assembled_decks: nextDecks,
    };
  }

  return state;
}
