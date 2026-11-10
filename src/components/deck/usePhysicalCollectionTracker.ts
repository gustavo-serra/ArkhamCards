import { useContext, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { filter, find, flatMap, forEach, isEqual, keys, map, sortBy, sumBy, uniq, values } from 'lodash';

import {
  AssembledDeckState,
  Campaign,
  CampaignId,
  CardPrintingOverrides,
  Deck,
  DeckId,
  DecksMap,
  FIXED_CHAOS_BAG_CAMPAIGN_ID,
  getCampaignLastUpdated,
  getDeckId,
  PhysicalCollectionMode,
  Slots,
} from '@actions/types';
import {
  AppState,
  getAllDecks,
  getAssembledDecks,
  getCardPrintingOverrides,
  getDeck,
  getDeckToCampaignMap,
  getPackQuantities,
  getPacksInCollection,
  getPhysicalCollectionMode,
} from '@reducers';
import { usePlayerCards, useSettingValue } from '@components/core/hooks';
import { PlayerCardContext } from '@data/sqlite/PlayerCardContext';
import Card, { CardsMap } from '@data/types/Card';
import { calculateCardCollectionQuantity, getCanonicalCardCode } from '@data/types/cardHelpers';
import { RANDOM_BASIC_WEAKNESS } from '@app_constants';
import ArkhamCardsAuthContext from '@lib/ArkhamCardsAuthContext';
import { useGetMyCampaignsQuery, useGetMyDecksQuery } from '@generated/graphql/apollo-schema';
import { LatestDeckRemote } from '@data/remote/types';

export interface TrackedPhysicalDeck {
  deckKey: string;
  deckId: DeckId;
  deck: Deck;
  investigatorCode: string;
  campaignId?: CampaignId;
  campaignUuid?: string;
  campaignName?: string;
  isArchivedCampaign: boolean;
  tracked: boolean;
  assembled: boolean;
  assembledAt: string;
  physicalSlots: Slots;
  targetSlots: Slots;
  hasPendingUpgrade: boolean;
}

export interface CardPhysicalHolder {
  deckKey: string;
  deckId: DeckId;
  deckName: string;
  investigatorCode: string;
  campaignId?: CampaignId;
  campaignName?: string;
  assembledAt: string;
  physicalCopies: number;
  targetCopies: number;
  heldCopies: number;
  borrowedCopies: number;
  borrowedByDecks: string[];
  hasPendingUpgrade: boolean;
}

export interface CardPhysicalAllocation {
  canonicalCode: string;
  totalOwned: number;
  inBinder: number;
  totalAllocated: number;
  totalPhysicalRequested: number;
  conflictCount: number;
  holders: CardPhysicalHolder[];
}

export interface ChecklistCardQuantity {
  code: string;
  canonicalCode: string;
  count: number;
}

export interface ChecklistRetrieveItem extends ChecklistCardQuantity {
  fromDeckKey: string;
  fromDeckId: DeckId;
  fromDeckName: string;
  fromInvestigatorCode: string;
  fromCampaignName?: string;
}

export interface DeckPhysicalChecklistPlan {
  deckKey: string;
  tracked: boolean;
  assembled: boolean;
  assembledAt?: string;
  hasPendingUpgrade: boolean;
  toReturnToBinder: ChecklistCardQuantity[];
  toRetrieveFromOtherDecks: ChecklistRetrieveItem[];
  toTakeFromBinder: ChecklistCardQuantity[];
  alreadyInDeckbox: ChecklistCardQuantity[];
  missingFromCollection: ChecklistCardQuantity[];
}

export function getSafeDeckUuid(deckId: DeckId | undefined): string {
  if (!deckId) {
    return '';
  }
  if (deckId.uuid && deckId.uuid !== 'undefined') {
    return deckId.uuid;
  }
  if (deckId.id !== undefined) {
    return `${deckId.id}`;
  }
  if (deckId.serverId !== undefined) {
    return `server_${deckId.serverId}`;
  }
  return '';
}

function findMatchingAssembledState(
  deckId: DeckId | undefined,
  assembledDecks?: { [deckKey: string]: AssembledDeckState | undefined }
): AssembledDeckState | undefined {
  if (!deckId || !assembledDecks) {
    return undefined;
  }
  const safeUuid = getSafeDeckUuid(deckId);
  if (safeUuid && assembledDecks[safeUuid]) {
    return assembledDecks[safeUuid];
  }
  return find(values(assembledDecks), entry => {
    if (!entry) {
      return false;
    }
    const entryUuid = getSafeDeckUuid(entry.deckId);
    if (safeUuid && (entry.deckKey === safeUuid || entryUuid === safeUuid)) {
      return true;
    }
    if (deckId.serverId !== undefined && entry.deckId?.serverId === deckId.serverId) {
      return true;
    }
    if (deckId.id !== undefined && entry.deckId?.id === deckId.id) {
      return true;
    }
    return false;
  });
}

/**
 * Walks backwards through `previousDeckId` to find a stable root deck UUID across XP upgrades,
 * or returns any ancestor UUID that has an explicit entry in `assembledDecks`.
 */
export function resolveCanonicalDeckKey(
  deck: Deck,
  allDecks: DecksMap,
  assembledDecks?: { [deckKey: string]: AssembledDeckState | undefined }
): string {
  const deckId = getDeckId(deck);
  const currentUuid = getSafeDeckUuid(deckId);
  if (!currentUuid) {
    return '';
  }
  if (assembledDecks && assembledDecks[currentUuid]) {
    return currentUuid;
  }
  const directMatch = findMatchingAssembledState(deckId, assembledDecks);
  if (directMatch?.deckKey) {
    return directMatch.deckKey;
  }
  const visited = new Set<string>([currentUuid]);
  let curr: Deck | undefined = deck;
  let rootUuid = currentUuid;
  while (curr && curr.previousDeckId) {
    const prevUuid = getSafeDeckUuid(curr.previousDeckId);
    if (!prevUuid || visited.has(prevUuid)) {
      break;
    }
    visited.add(prevUuid);
    if (assembledDecks && assembledDecks[prevUuid]) {
      return prevUuid;
    }
    const prevMatch = findMatchingAssembledState(curr.previousDeckId, assembledDecks);
    if (prevMatch?.deckKey) {
      return prevMatch.deckKey;
    }
    const prevDeck = getDeck(allDecks, curr.previousDeckId);
    if (!prevDeck) {
      rootUuid = prevUuid;
      break;
    }
    const nextRoot = getSafeDeckUuid(getDeckId(prevDeck));
    if (nextRoot) {
      rootUuid = nextRoot;
    }
    curr = prevDeck;
  }
  return rootUuid;
}

export function resolveDeckByKeyOrId(
  deckId: DeckId | undefined,
  allDecks: DecksMap,
  assembledDecks: { [deckKey: string]: AssembledDeckState | undefined }
): { deck?: Deck; deckKey: string; state?: AssembledDeckState } {
  const safeUuid = getSafeDeckUuid(deckId);
  if (!deckId || !safeUuid) {
    return { deckKey: '' };
  }
  const matchedState = findMatchingAssembledState(deckId, assembledDecks);
  const deck = getDeck(allDecks, deckId);
  if (!deck) {
    const key = matchedState?.deckKey || safeUuid;
    return {
      deckKey: key,
      state: assembledDecks[key] || matchedState,
    };
  }
  // Walk forward to latest version if needed
  let latest: Deck = deck;
  const visited = new Set<string>([getSafeDeckUuid(getDeckId(latest))]);
  while (latest.nextDeckId) {
    const nextUuid = getSafeDeckUuid(latest.nextDeckId);
    if (!nextUuid || visited.has(nextUuid)) {
      break;
    }
    visited.add(nextUuid);
    const nextDeck = getDeck(allDecks, latest.nextDeckId);
    if (!nextDeck) {
      break;
    }
    latest = nextDeck;
  }
  const deckKey = resolveCanonicalDeckKey(latest, allDecks, assembledDecks) || safeUuid;
  return {
    deck: latest,
    deckKey,
    state: assembledDecks[deckKey] || assembledDecks[safeUuid] || matchedState,
  };
}

function normalizeSlots(slots: Slots | undefined): Slots {
  const result: Slots = {};
  if (!slots) {
    return result;
  }
  forEach(slots, (count, code) => {
    if (count > 0 && code !== RANDOM_BASIC_WEAKNESS) {
      result[code] = count;
    }
  });
  return result;
}

function areSlotsEqual(a: Slots | undefined, b: Slots | undefined): boolean {
  return isEqual(normalizeSlots(a), normalizeSlots(b));
}

interface CampaignStatusLike {
  uuid: string;
  serverId?: number;
  name?: string;
  archived?: boolean;
  updatedAtIso?: string;
}

function getFallbackTimestamp(deck: Deck, campaign?: Campaign, campaignStatus?: CampaignStatusLike): string {
  if (campaign) {
    const lastUpdated = getCampaignLastUpdated(campaign);
    if (lastUpdated.getTime() > 0) {
      return lastUpdated.toISOString();
    }
  }
  if (campaignStatus?.updatedAtIso) {
    return campaignStatus.updatedAtIso;
  }
  return deck.date_update || deck.date_creation || new Date(0).toISOString();
}

export function isDeckTrackedAndAssembled(
  mode: PhysicalCollectionMode,
  state: AssembledDeckState | undefined,
  campaign: { archived?: boolean } | undefined
): { tracked: boolean; assembled: boolean } {
  if (mode === 'disabled') {
    return { tracked: false, assembled: false };
  }
  if (state && state.tracked === false) {
    return { tracked: false, assembled: false };
  }
  if (state && state.assembled) {
    return { tracked: true, assembled: true };
  }
  if (mode === 'manual') {
    return {
      tracked: !!state?.tracked,
      assembled: !!state?.assembled,
    };
  }
  if (mode === 'active_campaigns') {
    const isActiveCampaignDeck = !!campaign && !campaign.archived;
    if (state?.assembled === false) {
      return { tracked: isActiveCampaignDeck || !!state?.tracked, assembled: false };
    }
    return {
      tracked: isActiveCampaignDeck || !!state?.tracked,
      assembled: isActiveCampaignDeck,
    };
  }
  // mode === 'all_decks'
  const isArchived = !!campaign?.archived;
  if (state?.assembled === false) {
    return { tracked: !isArchived || !!state?.tracked, assembled: false };
  }
  return {
    tracked: !isArchived || !!state?.tracked,
    assembled: !isArchived,
  };
}

/**
 * Returns all latest decks in the app (Redux local/ArkhamDB decks, Remote Arkham Cards Cloud decks,
 * and any explicitly assembled decks) with their physical assembly status and slots.
 */
export function useTrackedPhysicalDecks(enabled: boolean = true): {
  mode: PhysicalCollectionMode;
  allTrackedDecks: TrackedPhysicalDeck[];
  assembledDecksList: TrackedPhysicalDeck[];
} {
  const mode = useSelector(getPhysicalCollectionMode);
  const assembledDecks = useSelector(getAssembledDecks);
  const allDecks = useSelector(getAllDecks);
  const deckToCampaign = useSelector(getDeckToCampaignMap);
  const allCampaigns = useSelector((state: AppState) => state.campaigns_2.all);

  const { userId } = useContext(ArkhamCardsAuthContext);
  const skipRemote = !userId || !enabled || mode === 'disabled';
  const { data: remoteDecksData } = useGetMyDecksQuery({
    variables: { userId: userId || '' },
    skip: skipRemote,
    fetchPolicy: 'cache-only',
  });
  const { data: remoteCampaignsData } = useGetMyCampaignsQuery({
    variables: { userId: userId || '' },
    skip: skipRemote,
    fetchPolicy: 'cache-only',
  });

  return useMemo(() => {
    if (!enabled || mode === 'disabled') {
      return {
        mode,
        allTrackedDecks: [],
        assembledDecksList: [],
      };
    }
    const remoteCampaignMap: { [uuid: string]: CampaignStatusLike | undefined } = {};
    forEach(remoteCampaignsData?.users_by_pk?.campaigns || [], entry => {
      const c = entry.campaign;
      if (c && c.uuid) {
        remoteCampaignMap[c.uuid] = {
          uuid: c.uuid,
          serverId: c.id,
          name: c.name || undefined,
          archived: !!c.archived,
          updatedAtIso: c.updated_at ? new Date(Date.parse(c.updated_at)).toISOString() : undefined,
        };
      }
    });

    const latestDecks = filter(values(allDecks), (d): d is Deck => !!d && !d.nextDeckId);
    const allTrackedDecks: TrackedPhysicalDeck[] = [];
    const seenDeckKeys = new Set<string>();
    const seenDeckUuids = new Set<string>();

    // 1. Process all Redux decks (local + ArkhamDB synced decks)
    forEach(latestDecks, deck => {
      const deckId = getDeckId(deck);
      const safeUuid = getSafeDeckUuid(deckId);
      if (!safeUuid) {
        return;
      }
      const campaign = deckToCampaign[safeUuid];
      if (campaign && campaign.uuid === FIXED_CHAOS_BAG_CAMPAIGN_ID.campaignId) {
        return;
      }
      const deckKey = resolveCanonicalDeckKey(deck, allDecks, assembledDecks) || safeUuid;
      const state = assembledDecks[deckKey] || assembledDecks[safeUuid] || findMatchingAssembledState(deckId, assembledDecks);
      const resolvedLocalCampaign = campaign || (state?.campaignId ? allCampaigns[state.campaignId.campaignId] : undefined);
      const resolvedRemoteCampaign = state?.campaignId ? remoteCampaignMap[state.campaignId.campaignId] : undefined;
      const campaignStatus: CampaignStatusLike | undefined = resolvedLocalCampaign
        ? {
            uuid: resolvedLocalCampaign.uuid,
            serverId: resolvedLocalCampaign.serverId,
            name: resolvedLocalCampaign.name,
            archived: !!resolvedLocalCampaign.archived,
          }
        : resolvedRemoteCampaign || (state?.campaignId ? {
            uuid: state.campaignId.campaignId,
            serverId: state.campaignId.serverId,
            name: state.campaignName,
            archived: false,
          } : undefined);

      const { tracked, assembled } = isDeckTrackedAndAssembled(mode, state, campaignStatus);
      const targetSlots = normalizeSlots(deck.slots);
      const physicalSlots = (assembled && state?.physicalSlots && keys(state.physicalSlots).length > 0)
        ? normalizeSlots(state.physicalSlots)
        : targetSlots;
      const hasPendingUpgrade = assembled && !areSlotsEqual(physicalSlots, targetSlots);
      const assembledAt = state?.assembledAt || getFallbackTimestamp(deck, resolvedLocalCampaign, campaignStatus);

      seenDeckKeys.add(deckKey);
      seenDeckUuids.add(safeUuid);

      allTrackedDecks.push({
        deckKey,
        deckId: state?.deckId || deckId,
        deck,
        investigatorCode: deck.investigator_code,
        campaignId: campaignStatus ? { campaignId: campaignStatus.uuid, serverId: campaignStatus.serverId } : state?.campaignId,
        campaignUuid: campaignStatus?.uuid || state?.campaignId?.campaignId,
        campaignName: campaignStatus?.name || state?.campaignName,
        isArchivedCampaign: !!campaignStatus?.archived,
        tracked,
        assembled,
        assembledAt,
        physicalSlots,
        targetSlots,
        hasPendingUpgrade,
      });
    });

    // 2. Process Remote Arkham Cards Cloud decks from Apollo cache
    forEach(remoteDecksData?.users_by_pk?.decks || [], entry => {
      if (!entry.deck) {
        return;
      }
      const remoteDeck = new LatestDeckRemote(entry.deck);
      const deckId = remoteDeck.id;
      const safeUuid = getSafeDeckUuid(deckId);
      if (!safeUuid) {
        return;
      }
      const deckKey = resolveCanonicalDeckKey(remoteDeck.deck, allDecks, assembledDecks) || safeUuid;
      if (seenDeckKeys.has(deckKey) || seenDeckUuids.has(safeUuid)) {
        return;
      }
      const state = assembledDecks[deckKey] || assembledDecks[safeUuid] || findMatchingAssembledState(deckId, assembledDecks);
      const campaignUuid = remoteDeck.campaign?.id.campaignId || state?.campaignId?.campaignId;
      if (campaignUuid === FIXED_CHAOS_BAG_CAMPAIGN_ID.campaignId) {
        return;
      }
      const localCampaign = campaignUuid ? allCampaigns[campaignUuid] : undefined;
      const remoteCampaign = campaignUuid ? remoteCampaignMap[campaignUuid] : undefined;
      const campaignStatus: CampaignStatusLike | undefined = localCampaign
        ? {
            uuid: localCampaign.uuid,
            serverId: localCampaign.serverId,
            name: localCampaign.name,
            archived: !!localCampaign.archived,
          }
        : remoteCampaign || (remoteDeck.campaign ? {
            uuid: remoteDeck.campaign.id.campaignId,
            serverId: remoteDeck.campaign.id.serverId,
            name: remoteDeck.campaign.name,
            archived: false,
          } : (state?.campaignId ? {
            uuid: state.campaignId.campaignId,
            serverId: state.campaignId.serverId,
            name: state.campaignName,
            archived: false,
          } : undefined));

      const { tracked, assembled } = isDeckTrackedAndAssembled(mode, state, campaignStatus);
      const targetSlots = normalizeSlots(remoteDeck.deck.slots);
      const physicalSlots = (assembled && state?.physicalSlots && keys(state.physicalSlots).length > 0)
        ? normalizeSlots(state.physicalSlots)
        : targetSlots;
      const hasPendingUpgrade = assembled && !areSlotsEqual(physicalSlots, targetSlots);
      const assembledAt = state?.assembledAt || getFallbackTimestamp(remoteDeck.deck, localCampaign, campaignStatus);

      seenDeckKeys.add(deckKey);
      seenDeckUuids.add(safeUuid);

      allTrackedDecks.push({
        deckKey,
        deckId,
        deck: remoteDeck.deck,
        investigatorCode: remoteDeck.investigator || remoteDeck.deck.investigator_code,
        campaignId: campaignStatus ? { campaignId: campaignStatus.uuid, serverId: campaignStatus.serverId } : (remoteDeck.campaign?.id || state?.campaignId),
        campaignUuid: campaignStatus?.uuid || campaignUuid,
        campaignName: campaignStatus?.name || remoteDeck.campaign?.name || state?.campaignName,
        isArchivedCampaign: !!campaignStatus?.archived,
        tracked,
        assembled,
        assembledAt,
        physicalSlots,
        targetSlots,
        hasPendingUpgrade,
      });
    });

    // 3. Synthesize any remaining entries in `assembledDecks` that weren't in `allDecks` or `remoteDecksData`
    forEach(assembledDecks, (state, key) => {
      if (!state || !state.deckId) {
        return;
      }
      const safeUuid = getSafeDeckUuid(state.deckId);
      const deckKey = state.deckKey || key || safeUuid;
      if (!deckKey || seenDeckKeys.has(deckKey) || (safeUuid && seenDeckUuids.has(safeUuid))) {
        return;
      }
      const campaignUuid = state.campaignId?.campaignId;
      if (campaignUuid === FIXED_CHAOS_BAG_CAMPAIGN_ID.campaignId) {
        return;
      }
      const localCampaign = campaignUuid ? allCampaigns[campaignUuid] : undefined;
      const remoteCampaign = campaignUuid ? remoteCampaignMap[campaignUuid] : undefined;
      const campaignStatus: CampaignStatusLike | undefined = localCampaign
        ? {
            uuid: localCampaign.uuid,
            serverId: localCampaign.serverId,
            name: localCampaign.name,
            archived: !!localCampaign.archived,
          }
        : remoteCampaign || (state.campaignId ? {
            uuid: state.campaignId.campaignId,
            serverId: state.campaignId.serverId,
            name: state.campaignName,
            archived: false,
          } : undefined);

      const { tracked, assembled } = isDeckTrackedAndAssembled(mode, state, campaignStatus);
      const normalizedPhysical = normalizeSlots(state.physicalSlots);
      const synthesizedDeck: Deck = state.deckId.local ? {
        local: true,
        uuid: safeUuid || deckKey,
        name: state.deckName || state.investigatorCode,
        investigator_code: state.investigatorCode,
        slots: normalizedPhysical,
        ignoreDeckLimitSlots: {},
        date_creation: state.assembledAt,
        date_update: state.assembledAt,
      } : {
        local: undefined,
        uuid: undefined,
        id: state.deckId.id || 0,
        user_id: state.deckId.arkhamdb_user || 0,
        name: state.deckName || state.investigatorCode,
        investigator_code: state.investigatorCode,
        slots: normalizedPhysical,
        ignoreDeckLimitSlots: {},
        date_creation: state.assembledAt,
        date_update: state.assembledAt,
      };

      seenDeckKeys.add(deckKey);
      if (safeUuid) {
        seenDeckUuids.add(safeUuid);
      }

      allTrackedDecks.push({
        deckKey,
        deckId: state.deckId,
        deck: synthesizedDeck,
        investigatorCode: state.investigatorCode,
        campaignId: state.campaignId,
        campaignUuid,
        campaignName: state.campaignName || campaignStatus?.name,
        isArchivedCampaign: !!campaignStatus?.archived,
        tracked,
        assembled,
        assembledAt: state.assembledAt,
        physicalSlots: normalizedPhysical,
        targetSlots: normalizedPhysical,
        hasPendingUpgrade: false,
      });
    });

    // Sort newest assembled first (higher priority for physical possession)
    const sorted = sortBy(allTrackedDecks, d => -new Date(d.assembledAt).getTime());
    const assembledDecksList = filter(sorted, d => d.assembled);

    return {
      mode,
      allTrackedDecks: sorted,
      assembledDecksList,
    };
  }, [enabled, mode, assembledDecks, allDecks, deckToCampaign, allCampaigns, remoteDecksData, remoteCampaignsData]);
}

function getCardOwnedCount(
  card: Card | undefined,
  inCollection: { [pack_code: string]: boolean },
  ignoreCollection: boolean,
  packQuantities: { [pack_code: string]: number | undefined },
  printingOverrides: CardPrintingOverrides
): number {
  if (!card) {
    return 0;
  }
  return calculateCardCollectionQuantity(
    card,
    inCollection,
    ignoreCollection,
    packQuantities,
    printingOverrides
  );
}

/**
 * Computes global physical card allocation across all assembled decks,
 * grouping printings/duplicates by `canonicalCode` and assigning physical copies
 * in descending order of `assembledAt` (most recently assembled deck holds physical priority).
 */
export function usePhysicalCollectionAllocations(
  extraCards?: CardsMap,
  enabled: boolean = true
): {
  mode: PhysicalCollectionMode;
  assembledDecksList: TrackedPhysicalDeck[];
  allTrackedDecks: TrackedPhysicalDeck[];
  allocationsByCanonicalCode: { [canonicalCode: string]: CardPhysicalAllocation };
  cardsMap: CardsMap;
  loading: boolean;
} {
  const { mode, allTrackedDecks, assembledDecksList } = useTrackedPhysicalDecks(enabled);
  const inCollection = useSelector(getPacksInCollection);
  const packQuantities = useSelector(getPackQuantities);
  const printingOverrides = useSelector(getCardPrintingOverrides);
  const ignoreCollection = useSettingValue('ignore_collection');
  const { getExistingCards } = useContext(PlayerCardContext);

  const neededCodes = useMemo(() => {
    if (!enabled || mode === 'disabled' || assembledDecksList.length === 0) {
      return [];
    }
    const rawCodes = uniq(
      flatMap(assembledDecksList, d => [
        d.investigatorCode,
        ...keys(d.physicalSlots),
        ...keys(d.targetSlots),
      ])
    );
    if (!extraCards) {
      return rawCodes;
    }
    return filter(rawCodes, code => !extraCards[code]);
  }, [enabled, mode, assembledDecksList, extraCards]);

  const [fetchedCards, loading] = usePlayerCards(neededCodes, false, 0);

  const cardsMap = useMemo(() => {
    const existing = getExistingCards ? getExistingCards(0) : {};
    return {
      ...existing,
      ...(fetchedCards || {}),
      ...(extraCards || {}),
    };
  }, [getExistingCards, fetchedCards, extraCards]);

  const allocationsByCanonicalCode = useMemo(() => {
    const result: { [canonicalCode: string]: CardPhysicalAllocation } = {};
    if (mode === 'disabled') {
      return result;
    }

    // Collect all canonical codes referenced by assembled decks
    const canonicalToSampleCard: { [canonicalCode: string]: Card | undefined } = {};
    const canonicalToDeckRequests: {
      [canonicalCode: string]: {
        deck: TrackedPhysicalDeck;
        physicalCopies: number;
        targetCopies: number;
      }[];
    } = {};

    forEach(assembledDecksList, trackedDeck => {
      const canonicalPhysicalCounts: { [canonicalCode: string]: number } = {};
      const canonicalTargetCounts: { [canonicalCode: string]: number } = {};

      forEach(trackedDeck.physicalSlots, (qty, code) => {
        const card = cardsMap[code];
        const canonicalCode = card ? getCanonicalCardCode(card) : code;
        if (card && !canonicalToSampleCard[canonicalCode]) {
          canonicalToSampleCard[canonicalCode] = card;
        }
        canonicalPhysicalCounts[canonicalCode] = (canonicalPhysicalCounts[canonicalCode] || 0) + qty;
      });

      forEach(trackedDeck.targetSlots, (qty, code) => {
        const card = cardsMap[code];
        const canonicalCode = card ? getCanonicalCardCode(card) : code;
        if (card && !canonicalToSampleCard[canonicalCode]) {
          canonicalToSampleCard[canonicalCode] = card;
        }
        canonicalTargetCounts[canonicalCode] = (canonicalTargetCounts[canonicalCode] || 0) + qty;
      });

      const allCanonicalsForDeck = uniq([
        ...keys(canonicalPhysicalCounts),
        ...keys(canonicalTargetCounts),
      ]);

      forEach(allCanonicalsForDeck, canonicalCode => {
        const physicalCopies = canonicalPhysicalCounts[canonicalCode] || 0;
        const targetCopies = canonicalTargetCounts[canonicalCode] || 0;
        if (physicalCopies > 0 || targetCopies > 0) {
          if (!canonicalToDeckRequests[canonicalCode]) {
            canonicalToDeckRequests[canonicalCode] = [];
          }
          canonicalToDeckRequests[canonicalCode].push({
            deck: trackedDeck,
            physicalCopies,
            targetCopies,
          });
        }
      });
    });

    // Since `assembledDecksList` is already sorted by `assembledAt` descending,
    // we allocate physical copies from `totalOwned` in that exact order.
    forEach(canonicalToDeckRequests, (requests, canonicalCode) => {
      const sampleCard = canonicalToSampleCard[canonicalCode] || cardsMap[canonicalCode];
      const totalOwned = getCardOwnedCount(
        sampleCard,
        inCollection,
        ignoreCollection,
        packQuantities,
        printingOverrides
      );

      let remainingAvailable = totalOwned;
      let totalAllocated = 0;
      let totalPhysicalRequested = 0;
      const activeClaimers: string[] = [];

      const holders: CardPhysicalHolder[] = map(requests, ({ deck, physicalCopies, targetCopies }) => {
        totalPhysicalRequested += physicalCopies;
        const heldCopies = Math.min(physicalCopies, Math.max(0, remainingAvailable));
        remainingAvailable = Math.max(0, remainingAvailable - heldCopies);
        totalAllocated += heldCopies;
        const borrowedCopies = Math.max(0, physicalCopies - heldCopies);
        const borrowedByDecks = borrowedCopies > 0 ? [...activeClaimers] : [];
        if (heldCopies > 0) {
          activeClaimers.push(deck.deck.name);
        }

        return {
          deckKey: deck.deckKey,
          deckId: deck.deckId,
          deckName: deck.deck.name,
          investigatorCode: deck.investigatorCode,
          campaignId: deck.campaignId,
          campaignName: deck.campaignName,
          assembledAt: deck.assembledAt,
          physicalCopies,
          targetCopies,
          heldCopies,
          borrowedCopies,
          borrowedByDecks,
          hasPendingUpgrade: physicalCopies !== targetCopies,
        };
      });

      result[canonicalCode] = {
        canonicalCode,
        totalOwned,
        inBinder: Math.max(0, totalOwned - totalAllocated),
        totalAllocated,
        totalPhysicalRequested,
        conflictCount: Math.max(0, totalPhysicalRequested - totalOwned),
        holders,
      };
    });

    return result;
  }, [
    mode,
    assembledDecksList,
    cardsMap,
    inCollection,
    ignoreCollection,
    packQuantities,
    printingOverrides,
  ]);

  return {
    mode,
    assembledDecksList,
    allTrackedDecks,
    allocationsByCanonicalCode,
    cardsMap,
    loading,
  };
}

/**
 * Returns physical allocation info for a single card (used in CardDetailView & CardSearchResult).
 */
export function useCardPhysicalAllocation(card: Card | undefined): CardPhysicalAllocation | undefined {
  const extraCards = useMemo(() => (card ? { [card.code]: card } : undefined), [card]);
  const { mode, allocationsByCanonicalCode } = usePhysicalCollectionAllocations(extraCards);
  const inCollection = useSelector(getPacksInCollection);
  const packQuantities = useSelector(getPackQuantities);
  const printingOverrides = useSelector(getCardPrintingOverrides);
  const ignoreCollection = useSettingValue('ignore_collection');

  return useMemo(() => {
    if (!card || mode === 'disabled') {
      return undefined;
    }
    const canonicalCode = getCanonicalCardCode(card);
    const existing = allocationsByCanonicalCode[canonicalCode];
    if (existing) {
      return existing;
    }
    const totalOwned = getCardOwnedCount(
      card,
      inCollection,
      ignoreCollection,
      packQuantities,
      printingOverrides
    );
    return {
      canonicalCode,
      totalOwned,
      inBinder: totalOwned,
      totalAllocated: 0,
      totalPhysicalRequested: 0,
      conflictCount: 0,
      holders: [],
    };
  }, [card, mode, allocationsByCanonicalCode, inCollection, ignoreCollection, packQuantities, printingOverrides]);
}

/**
 * Computes the 4-section physical assembly & upgrade checklist plan for a specific deck.
 */
export function useDeckPhysicalChecklistPlan(
  deckId: DeckId | undefined,
  currentSlots: Slots | undefined,
  extraCards?: CardsMap
): {
  plan: DeckPhysicalChecklistPlan;
  cardsMap: CardsMap;
  loading: boolean;
} {
  const allDecks = useSelector(getAllDecks);
  const assembledDecks = useSelector(getAssembledDecks);
  const deckToCampaign = useSelector(getDeckToCampaignMap);
  const inCollection = useSelector(getPacksInCollection);
  const packQuantities = useSelector(getPackQuantities);
  const printingOverrides = useSelector(getCardPrintingOverrides);
  const ignoreCollection = useSettingValue('ignore_collection');

  const { mode, allTrackedDecks, allocationsByCanonicalCode, cardsMap: baseCardsMap, loading: baseLoading } = usePhysicalCollectionAllocations(extraCards);

  const { deck, deckKey, state, trackedDeck } = useMemo(() => {
    const resolved = resolveDeckByKeyOrId(deckId, allDecks, assembledDecks);
    const safeUuid = getSafeDeckUuid(deckId);
    const matchedTracked = find(allTrackedDecks, d =>
      (resolved.deckKey && d.deckKey === resolved.deckKey) ||
      (safeUuid && (d.deckKey === safeUuid || getSafeDeckUuid(d.deckId) === safeUuid)) ||
      (deckId?.serverId !== undefined && d.deckId.serverId === deckId.serverId)
    );
    const effectiveKey = matchedTracked?.deckKey || resolved.deckKey || safeUuid;
    const effectiveState = resolved.state || (effectiveKey ? assembledDecks[effectiveKey] : undefined);
    return {
      deck: resolved.deck || matchedTracked?.deck,
      deckKey: effectiveKey,
      state: effectiveState,
      trackedDeck: matchedTracked,
    };
  }, [deckId, allDecks, assembledDecks, allTrackedDecks]);

  const targetSlots = useMemo(
    () => normalizeSlots(currentSlots ?? deck?.slots ?? trackedDeck?.targetSlots ?? state?.physicalSlots),
    [currentSlots, deck?.slots, trackedDeck?.targetSlots, state?.physicalSlots]
  );
  const physicalSlots = useMemo(() => {
    if (state?.assembled && state?.physicalSlots && keys(state.physicalSlots).length > 0) {
      return normalizeSlots(state.physicalSlots);
    }
    return targetSlots;
  }, [state, targetSlots]);

  const deckCardCodes = useMemo(() => {
    const allCodes = uniq([...keys(targetSlots), ...keys(physicalSlots)]);
    if (!extraCards) {
      return allCodes;
    }
    return filter(allCodes, code => !extraCards[code]);
  }, [targetSlots, physicalSlots, extraCards]);

  const [deckCards, deckCardsLoading] = usePlayerCards(deckCardCodes, false, 0);

  const cardsMap = useMemo(() => ({
    ...baseCardsMap,
    ...(deckCards || {}),
    ...(extraCards || {}),
  }), [baseCardsMap, deckCards, extraCards]);

  const plan = useMemo((): DeckPhysicalChecklistPlan => {
    const safeUuid = getSafeDeckUuid(deckId);
    const campaign = safeUuid ? deckToCampaign[safeUuid] : undefined;
    const campaignStatus = campaign
      ? { archived: !!campaign.archived }
      : (trackedDeck?.campaignId ? { archived: trackedDeck.isArchivedCampaign } : undefined);
    const { tracked, assembled } = trackedDeck
      ? { tracked: trackedDeck.tracked, assembled: trackedDeck.assembled }
      : isDeckTrackedAndAssembled(mode, state, campaignStatus);
    const hasPendingUpgrade = assembled && !areSlotsEqual(physicalSlots, targetSlots);

    const toReturnToBinder: ChecklistCardQuantity[] = [];
    const toRetrieveFromOtherDecks: ChecklistRetrieveItem[] = [];
    const toTakeFromBinder: ChecklistCardQuantity[] = [];
    const alreadyInDeckbox: ChecklistCardQuantity[] = [];
    const missingFromCollection: ChecklistCardQuantity[] = [];

    // Group targetSlots and physicalSlots by canonicalCode while preserving the specific printing code used in the deck
    const canonicalGroup: {
      [canonicalCode: string]: {
        code: string;
        targetCount: number;
        physicalCount: number;
      };
    } = {};

    forEach(physicalSlots, (qty, code) => {
      const card = cardsMap[code];
      const canonicalCode = card ? getCanonicalCardCode(card) : code;
      if (!canonicalGroup[canonicalCode]) {
        canonicalGroup[canonicalCode] = { code, targetCount: 0, physicalCount: 0 };
      }
      canonicalGroup[canonicalCode].physicalCount += qty;
    });

    forEach(targetSlots, (qty, code) => {
      const card = cardsMap[code];
      const canonicalCode = card ? getCanonicalCardCode(card) : code;
      if (!canonicalGroup[canonicalCode]) {
        canonicalGroup[canonicalCode] = { code, targetCount: 0, physicalCount: 0 };
      } else {
        canonicalGroup[canonicalCode].code = code;
      }
      canonicalGroup[canonicalCode].targetCount += qty;
    });

    forEach(canonicalGroup, ({ code, targetCount }, canonicalCode) => {
      const card = cardsMap[code] || cardsMap[canonicalCode];
      const allocation = allocationsByCanonicalCode[canonicalCode];
      const totalOwned = allocation
        ? allocation.totalOwned
        : getCardOwnedCount(card, inCollection, ignoreCollection, packQuantities, printingOverrides);

      const selfHolder = allocation?.holders.find(h => h.deckKey === deckKey);
      const heldBySelfNow = assembled ? (selfHolder?.heldCopies ?? 0) : 0;
      const otherHolders = filter(allocation?.holders || [], h => h.deckKey !== deckKey && h.heldCopies > 0);
      const heldByOthersTotal = sumBy(otherHolders, h => h.heldCopies);
      const inBinderNow = Math.max(0, totalOwned - heldBySelfNow - heldByOthersTotal);

      if (heldBySelfNow > targetCount) {
        if (targetCount > 0) {
          alreadyInDeckbox.push({
            code,
            canonicalCode,
            count: targetCount,
          });
        }
        toReturnToBinder.push({
          code,
          canonicalCode,
          count: heldBySelfNow - targetCount,
        });
      } else {
        if (heldBySelfNow > 0) {
          alreadyInDeckbox.push({
            code,
            canonicalCode,
            count: heldBySelfNow,
          });
        }
        let needed = targetCount - heldBySelfNow;
        if (needed > 0 && inBinderNow > 0) {
          const fromBinder = Math.min(needed, inBinderNow);
          toTakeFromBinder.push({
            code,
            canonicalCode,
            count: fromBinder,
          });
          needed -= fromBinder;
        }
        if (needed > 0 && otherHolders.length > 0) {
          // Retrieve from oldest assembled decks first so the most recently played decks are disturbed last
          const sortedOtherHolders = sortBy(otherHolders, h => new Date(h.assembledAt).getTime());
          forEach(sortedOtherHolders, holder => {
            if (needed <= 0) {
              return;
            }
            const take = Math.min(needed, holder.heldCopies);
            if (take > 0) {
              toRetrieveFromOtherDecks.push({
                code,
                canonicalCode,
                count: take,
                fromDeckKey: holder.deckKey,
                fromDeckId: holder.deckId,
                fromDeckName: holder.deckName,
                fromInvestigatorCode: holder.investigatorCode,
                fromCampaignName: holder.campaignName,
              });
              needed -= take;
            }
          });
        }
        if (needed > 0) {
          missingFromCollection.push({
            code,
            canonicalCode,
            count: needed,
          });
        }
      }
    });

    return {
      deckKey,
      tracked,
      assembled,
      assembledAt: state?.assembledAt || trackedDeck?.assembledAt,
      hasPendingUpgrade,
      toReturnToBinder,
      toRetrieveFromOtherDecks,
      toTakeFromBinder,
      alreadyInDeckbox,
      missingFromCollection,
    };
  }, [
    deckId,
    deckKey,
    state,
    trackedDeck,
    mode,
    deckToCampaign,
    physicalSlots,
    targetSlots,
    cardsMap,
    allocationsByCanonicalCode,
    inCollection,
    ignoreCollection,
    packQuantities,
    printingOverrides,
  ]);

  return {
    plan,
    cardsMap,
    loading: baseLoading || deckCardsLoading,
  };
}
