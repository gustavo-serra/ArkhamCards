import { forEach } from 'lodash';
import {
  AssembledDeckState,
  CONFIRM_PHYSICAL_DECK_ASSEMBLY,
  DISASSEMBLE_CAMPAIGN_DECKS,
  DISASSEMBLE_PHYSICAL_DECK,
  PhysicalCollectionActions,
  PhysicalCollectionMode,
  SET_DECK_PHYSICAL_TRACKING,
  SET_PHYSICAL_COLLECTION_MODE,
} from '@actions/types';

export interface PhysicalCollectionState {
  mode: PhysicalCollectionMode;
  assembledDecks: {
    [deckKey: string]: AssembledDeckState | undefined;
  };
}

const DEFAULT_PHYSICAL_COLLECTION_STATE: PhysicalCollectionState = {
  mode: 'manual',
  assembledDecks: {},
};

export default function physicalCollection(
  state: PhysicalCollectionState = DEFAULT_PHYSICAL_COLLECTION_STATE,
  action: PhysicalCollectionActions
): PhysicalCollectionState {
  switch (action.type) {
    case SET_PHYSICAL_COLLECTION_MODE:
      return {
        ...state,
        mode: action.mode,
      };
    case CONFIRM_PHYSICAL_DECK_ASSEMBLY: {
      const nextDecks = { ...(state.assembledDecks || {}) };
      nextDecks[action.deckKey] = {
        deckKey: action.deckKey,
        campaignId: action.campaignId,
        campaignName: action.campaignName,
        investigatorCode: action.investigatorCode,
        deckId: action.deckId,
        deckName: action.deckName,
        tracked: true,
        assembled: true,
        physicalSlots: { ...action.physicalSlots },
        assembledAt: action.assembledAt,
      };
      return {
        ...state,
        assembledDecks: nextDecks,
      };
    }
    case DISASSEMBLE_PHYSICAL_DECK: {
      const nextDecks = { ...(state.assembledDecks || {}) };
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
        assembledDecks: nextDecks,
      };
    }
    case SET_DECK_PHYSICAL_TRACKING: {
      const nextDecks = { ...(state.assembledDecks || {}) };
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
        assembledDecks: nextDecks,
      };
    }
    case DISASSEMBLE_CAMPAIGN_DECKS: {
      const nextDecks = { ...(state.assembledDecks || {}) };
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
        assembledDecks: nextDecks,
      };
    }
    default:
      return state;
  }
}
