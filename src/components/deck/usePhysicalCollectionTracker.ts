import { useContext, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { filter, flatMap, forEach, isEqual, keys, map, sortBy, sumBy, uniq, values } from 'lodash';

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

/**
 * Walks backwards through `previousDeckId` to find a stable root deck UUID across XP upgrades,
 * or returns any ancestor UUID that has an explicit entry in `assembledDecks`.
 */
export function resolveCanonicalDeckKey(
  deck: Deck,
  allDecks: DecksMap,
  assembledDecks?: { [deckKey: string]: AssembledDeckState | undefined }
): string {
  const currentUuid = getDeckId(deck).uuid;
  if (assembledDecks && assembledDecks[currentUuid]) {
    return currentUuid;
  }
  const visited = new Set<string>([currentUuid]);
  let curr: Deck | undefined = deck;
  let rootUuid = currentUuid;
  while (curr && curr.previousDeckId) {
    const prevUuid = curr.previousDeckId.uuid;
    if (visited.has(prevUuid)) {
      break;
    }
    visited.add(prevUuid);
    if (assembledDecks && assembledDecks[prevUuid]) {
      return prevUuid;
    }
    const prevDeck = getDeck(allDecks, curr.previousDeckId);
    if (!prevDeck) {
      rootUuid = prevUuid;
      break;
    }
    rootUuid = getDeckId(prevDeck).uuid;
    curr = prevDeck;
  }
  return rootUuid;
}

export function resolveDeckByKeyOrId(
  deckId: DeckId | undefined,
  allDecks: DecksMap,
  assembledDecks: { [deckKey: string]: AssembledDeckState | undefined }
): { deck?: Deck; deckKey: string; state?: AssembledDeckState } {
  if (!deckId) {
    return { deckKey: '' };
  }
  const deck = getDeck(allDecks, deckId);
  if (!deck) {
    return {
      deckKey: deckId.uuid,
      state: assembledDecks[deckId.uuid],
    };
  }
  // Walk forward to latest version if needed
  let latest: Deck = deck;
  const visited = new Set<string>([getDeckId(latest).uuid]);
  while (latest.nextDeckId) {
    const nextUuid = latest.nextDeckId.uuid;
    if (visited.has(nextUuid)) {
      break;
    }
    visited.add(nextUuid);
    const nextDeck = getDeck(allDecks, latest.nextDeckId);
    if (!nextDeck) {
      break;
    }
    latest = nextDeck;
  }
  const deckKey = resolveCanonicalDeckKey(latest, allDecks, assembledDecks);
  return {
    deck: latest,
    deckKey,
    state: assembledDecks[deckKey] || assembledDecks[deckId.uuid],
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

function getFallbackTimestamp(deck: Deck, campaign?: Campaign): string {
  if (campaign) {
    const lastUpdated = getCampaignLastUpdated(campaign);
    if (lastUpdated.getTime() > 0) {
      return lastUpdated.toISOString();
    }
  }
  return deck.date_update || deck.date_creation || new Date(0).toISOString();
}

export function isDeckTrackedAndAssembled(
  mode: PhysicalCollectionMode,
  state: AssembledDeckState | undefined,
  campaign: Campaign | undefined
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
 * Returns all latest decks in the app with their physical assembly status and slots.
 */
export function useTrackedPhysicalDecks(): {
  mode: PhysicalCollectionMode;
  allTrackedDecks: TrackedPhysicalDeck[];
  assembledDecksList: TrackedPhysicalDeck[];
} {
  const mode = useSelector(getPhysicalCollectionMode);
  const assembledDecks = useSelector(getAssembledDecks);
  const allDecks = useSelector(getAllDecks);
  const deckToCampaign = useSelector(getDeckToCampaignMap);
  const allCampaigns = useSelector((state: AppState) => state.campaigns_2.all);

  return useMemo(() => {
    const latestDecks = filter(values(allDecks), (d): d is Deck => !!d && !d.nextDeckId);
    const allTrackedDecks: TrackedPhysicalDeck[] = [];

    forEach(latestDecks, deck => {
      const deckId = getDeckId(deck);
      const campaign = deckToCampaign[deckId.uuid];
      if (campaign && campaign.uuid === FIXED_CHAOS_BAG_CAMPAIGN_ID.campaignId) {
        return;
      }
      const deckKey = resolveCanonicalDeckKey(deck, allDecks, assembledDecks);
      const state = assembledDecks[deckKey] || assembledDecks[deckId.uuid];
      const resolvedCampaign = campaign || (state?.campaignId ? allCampaigns[state.campaignId.campaignId] : undefined);
      const { tracked, assembled } = isDeckTrackedAndAssembled(mode, state, resolvedCampaign);
      const targetSlots = normalizeSlots(deck.slots);
      const physicalSlots = (assembled && state?.physicalSlots)
        ? normalizeSlots(state.physicalSlots)
        : targetSlots;
      const hasPendingUpgrade = assembled && !areSlotsEqual(physicalSlots, targetSlots);
      const assembledAt = state?.assembledAt || getFallbackTimestamp(deck, resolvedCampaign);

      allTrackedDecks.push({
        deckKey,
        deckId,
        deck,
        investigatorCode: deck.investigator_code,
        campaignId: resolvedCampaign ? { campaignId: resolvedCampaign.uuid, serverId: resolvedCampaign.serverId } : undefined,
        campaignUuid: resolvedCampaign?.uuid,
        campaignName: resolvedCampaign?.name,
        isArchivedCampaign: !!resolvedCampaign?.archived,
        tracked,
        assembled,
        assembledAt,
        physicalSlots,
        targetSlots,
        hasPendingUpgrade,
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
  }, [mode, assembledDecks, allDecks, deckToCampaign, allCampaigns]);
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
export function usePhysicalCollectionAllocations(extraCards?: CardsMap): {
  mode: PhysicalCollectionMode;
  assembledDecksList: TrackedPhysicalDeck[];
  allTrackedDecks: TrackedPhysicalDeck[];
  allocationsByCanonicalCode: { [canonicalCode: string]: CardPhysicalAllocation };
  cardsMap: CardsMap;
  loading: boolean;
} {
  const { mode, allTrackedDecks, assembledDecksList } = useTrackedPhysicalDecks();
  const inCollection = useSelector(getPacksInCollection);
  const packQuantities = useSelector(getPackQuantities);
  const printingOverrides = useSelector(getCardPrintingOverrides);
  const ignoreCollection = useSettingValue('ignore_collection');
  const { getExistingCards } = useContext(PlayerCardContext);

  const neededCodes = useMemo(() => {
    if (mode === 'disabled') {
      return [];
    }
    return uniq(
      flatMap(allTrackedDecks, d => [
        d.investigatorCode,
        ...keys(d.physicalSlots),
        ...keys(d.targetSlots),
      ])
    );
  }, [mode, allTrackedDecks]);

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

  const { deck, deckKey, state } = useMemo(
    () => resolveDeckByKeyOrId(deckId, allDecks, assembledDecks),
    [deckId, allDecks, assembledDecks]
  );

  const { mode, allocationsByCanonicalCode, cardsMap: baseCardsMap, loading: baseLoading } = usePhysicalCollectionAllocations(extraCards);

  const targetSlots = useMemo(() => normalizeSlots(currentSlots ?? deck?.slots), [currentSlots, deck?.slots]);
  const physicalSlots = useMemo(() => {
    if (state?.assembled && state?.physicalSlots) {
      return normalizeSlots(state.physicalSlots);
    }
    return targetSlots;
  }, [state, targetSlots]);

  const deckCardCodes = useMemo(
    () => uniq([...keys(targetSlots), ...keys(physicalSlots)]),
    [targetSlots, physicalSlots]
  );

  const [deckCards, deckCardsLoading] = usePlayerCards(deckCardCodes, false, 0);

  const cardsMap = useMemo(() => ({
    ...baseCardsMap,
    ...(deckCards || {}),
    ...(extraCards || {}),
  }), [baseCardsMap, deckCards, extraCards]);

  const plan = useMemo((): DeckPhysicalChecklistPlan => {
    const campaign = deckId ? deckToCampaign[deckId.uuid] : undefined;
    const { tracked, assembled } = isDeckTrackedAndAssembled(mode, state, campaign);
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
      assembledAt: state?.assembledAt,
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
