import { FactionCodeType, getSpecialPackNames, SkillCodeType, specialReprintCampaignPacks, specialReprintCardPacks, specialReprintPlayerPacks } from '@app_constants';
import { CardPrintingOverrides } from '@actions/types';
import { find, forEach, sum, values } from 'lodash';
import Card, { CardStatusType } from './Card';
import { ListCard } from './ListCard';

/**
 * Shared helper functions for Card and ListCard
 * These take Pick<Card> to work with both full Card objects and ListCardImpl
 */

export function getCanonicalCardCode(
  card: Pick<Card, 'code' | 'duplicate_of_code' | 'reprint_of_code'>
): string {
  return card.duplicate_of_code || card.reprint_of_code || card.code;
}

export function getPackCopies(
  packCode: string,
  packInCollection: { [pack_code: string]: boolean | undefined },
  packQuantities?: { [pack_code: string]: number | undefined }
): number {
  if (packCode === 'core') {
    if (packQuantities?.core !== undefined) {
      return Math.max(0, packQuantities.core);
    }
    if (packInCollection.no_core) {
      return 0;
    }
    if (packInCollection.core) {
      return 2;
    }
    return 1;
  }
  if (!packInCollection[packCode]) {
    return 0;
  }
  const explicitQty = packQuantities?.[packCode];
  return explicitQty !== undefined ? Math.max(0, explicitQty) : 1;
}

export interface CardPrintingSourceBreakdown {
  packCode: string;
  packName?: string;
  cardCode?: string;
  position?: number;
  quantityPerPack: number;
  packsOwned: number;
  baseCopies: number;
  manualDelta: number;
  totalCopies: number;
}

export function getCardPrintingBreakdown(
  card: Pick<
    Card,
    | 'code'
    | 'duplicate_of_code'
    | 'reprint_of_code'
    | 'pack_code'
    | 'pack_name'
    | 'position'
    | 'encounter_code'
    | 'quantity'
    | 'reprint_info'
    | 'reprint_pack_codes'
  >,
  packInCollection: { [pack_code: string]: boolean | undefined },
  packQuantities?: { [pack_code: string]: number | undefined },
  cardPrintingOverrides?: CardPrintingOverrides,
  packNamesMap?: { [pack_code: string]: string | undefined }
): {
  canonicalCode: string;
  sources: CardPrintingSourceBreakdown[];
  extraManualDelta: number;
  totalOwned: number;
} {
  const canonicalCode = getCanonicalCardCode(card);
  const overridesForCard = cardPrintingOverrides?.[canonicalCode] || {};
  const specialPackNames = getSpecialPackNames();
  const seenPacks = new Set<string>();
  const sources: CardPrintingSourceBreakdown[] = [];

  const addSource = (
    packCode: string,
    quantityPerPack: number,
    packName?: string,
    cardCode?: string,
    position?: number
  ) => {
    if (!packCode || seenPacks.has(packCode)) {
      return;
    }
    seenPacks.add(packCode);
    const packsOwned = getPackCopies(packCode, packInCollection, packQuantities);
    const baseCopies = packsOwned * quantityPerPack;
    const manualDelta = overridesForCard[packCode] || 0;
    const totalCopies = Math.max(0, baseCopies + manualDelta);
    sources.push({
      packCode,
      packName: packName || packNamesMap?.[packCode] || specialPackNames[packCode] || packCode,
      cardCode,
      position,
      quantityPerPack,
      packsOwned,
      baseCopies,
      manualDelta,
      totalCopies,
    });
  };

  const baseQty = card.quantity || 0;
  addSource(card.pack_code, baseQty, card.pack_name, card.code, card.position);

  const alternatePack = card.encounter_code
    ? specialReprintCampaignPacks[card.pack_code]
    : specialReprintPlayerPacks[card.pack_code];
  if (alternatePack) {
    addSource(alternatePack, baseQty, specialPackNames[alternatePack], card.code, card.position);
  }

  const alternateCodePack = specialReprintCardPacks[card.code];
  if (alternateCodePack) {
    addSource(alternateCodePack, baseQty, specialPackNames[alternateCodePack], card.code, card.position);
  }

  if (card.reprint_info?.length) {
    forEach(card.reprint_info, (reprint) => {
      if (reprint.pack_code) {
        const rQty = reprint.quantity || baseQty;
        addSource(
          reprint.pack_code,
          rQty,
          reprint.pack_name,
          reprint.code,
          reprint.position
        );
        const rAltPack = card.encounter_code
          ? specialReprintCampaignPacks[reprint.pack_code]
          : specialReprintPlayerPacks[reprint.pack_code];
        if (rAltPack) {
          addSource(rAltPack, rQty, specialPackNames[rAltPack], reprint.code, reprint.position);
        }
      }
    });
  } else if (card.reprint_pack_codes?.length) {
    forEach(card.reprint_pack_codes, (packCode) => {
      addSource(packCode, baseQty);
      const rAltPack = card.encounter_code
        ? specialReprintCampaignPacks[packCode]
        : specialReprintPlayerPacks[packCode];
      if (rAltPack) {
        addSource(rAltPack, baseQty, specialPackNames[rAltPack]);
      }
    });
  }

  const extraManualDelta = overridesForCard.extra || 0;
  const sourcesTotal = sum(sources.map((s) => s.totalCopies));
  const totalOwned = Math.max(0, sourcesTotal + extraManualDelta);

  return {
    canonicalCode,
    sources,
    extraManualDelta,
    totalOwned,
  };
}

export function calculateCardCollectionQuantity(
  card: Pick<
    Card,
    | 'code'
    | 'duplicate_of_code'
    | 'reprint_of_code'
    | 'pack_code'
    | 'pack_name'
    | 'position'
    | 'encounter_code'
    | 'subtype_code'
    | 'quantity'
    | 'deck_limit'
    | 'reprint_info'
    | 'reprint_pack_codes'
  >,
  packInCollection: { [pack_code: string]: boolean | undefined },
  ignore_collection: boolean,
  packQuantities?: { [pack_code: string]: number | undefined },
  cardPrintingOverrides?: CardPrintingOverrides
): number {
  const breakdown = getCardPrintingBreakdown(
    card,
    packInCollection,
    packQuantities,
    cardPrintingOverrides
  );
  if (ignore_collection && breakdown.totalOwned === 0) {
    return Math.max(card.deck_limit || 0, card.quantity || 0);
  }
  return breakdown.totalOwned;
}

export function cardFactionCode(card: Pick<Card, 'faction_code'>): FactionCodeType {
  return (card.faction_code as FactionCodeType) || 'neutral';
}

export function cardSkillCount(
  card: Pick<Card, 'skill_willpower' | 'skill_intellect' | 'skill_combat' | 'skill_agility' | 'skill_wild'>,
  skill: SkillCodeType
): number {
  switch (skill) {
    case 'willpower':
      return card.skill_willpower || 0;
    case 'intellect':
      return card.skill_intellect || 0;
    case 'combat':
      return card.skill_combat || 0;
    case 'agility':
      return card.skill_agility || 0;
    case 'wild':
      return card.skill_wild || 0;
    default: {
      return 0;
    }
  }
}

export function cardCustom(card: Pick<Card, 'status' | 'code'>): boolean {
  return (
    card.status === CardStatusType.CUSTOM ||
    card.status === CardStatusType.PREVIEW ||
    card.code.startsWith('z')
  );
}

export function cardRealCost(
  card: Pick<Card, 'type_code' | 'cost' | 'permanent' | 'double_sided'>,
  linked?: boolean
): string | null {
  if (card.type_code !== 'asset' && card.type_code !== 'event') {
    return null;
  }
  if (card.cost === -2) {
    return 'X';
  }
  if (card.permanent || card.double_sided || linked || card.cost === null) {
    return '-';
  }
  return `${card.cost}`;
}


const REPRINT_CARDS: {
  [code: string]: string[] | undefined;
} = {
  '01017': ['nat'],
  '01023': ['nat'],
  '01025': ['nat'],
  '02186': ['har'],
  '02020': ['har'],
  '01039': ['har'],
  '01044': ['win'],
  '03030': ['win'],
  '04107': ['win'],
  '04232': ['win'],
  '03194': ['win'],
  '01053': ['win'],
  '02029': ['jac'],
  '03034': ['jac'],
  '02190': ['jac'],
  '02153': ['jac'],
  '04032': ['jac'],

  '07004': ['bob'],
  '07005': ['tdg'],
  '02003': ['hoth'],
  '05001': ['tftbw'],
  '08004': ['iotv'],
};

export function cardInCollection(
  card: Card | ListCard,
  packInCollection: { [pack_code: string]: boolean | undefined }
): boolean {
  if (packInCollection[card.pack_code]) {
    return true;
  }
  const alternatePack = card.encounter_code
    ? specialReprintCampaignPacks[card.pack_code]
    : specialReprintPlayerPacks[card.pack_code];
  if (alternatePack && packInCollection[alternatePack]) {
    return true;
  }
  const alternateCardPack = specialReprintCardPacks[card.code];
  if (alternateCardPack && packInCollection[alternateCardPack]) {
    return true;
  }
  const reprintPacks = card.reprint_pack_codes || REPRINT_CARDS[card.code];
  if (!reprintPacks) {
    return false;
  }
  return !!find(reprintPacks, (pack) => !!packInCollection[pack]);
}

export function cardCollectionDeckLimit(
  card: Pick<Card, 'pack_code' | 'deck_limit' | 'reprint_pack_codes' | 'code' | 'quantity' | 'duplicate_of_code' | 'reprint_of_code'>,
  packInCollection: { [pack_code: string]: boolean | undefined },
  ignore_collection: boolean,
  packQuantities?: { [pack_code: string]: number | undefined },
  cardPrintingOverrides?: CardPrintingOverrides
): number {
  if (ignore_collection) {
    return card.deck_limit || 0;
  }
  const canonicalCode = getCanonicalCardCode(card);
  const manualTotal = sum(values(cardPrintingOverrides?.[canonicalCode] || {}));
  if (card.pack_code !== 'core' || packInCollection.core || (packQuantities?.core || 0) >= 2) {
    const baseLimit = card.deck_limit || 0;
    return manualTotal < 0 ? Math.max(0, baseLimit + manualTotal) : baseLimit;
  }
  const reprintPacks = card.reprint_pack_codes || REPRINT_CARDS[card.code];
  if (
    reprintPacks &&
    find(reprintPacks, (pack) => !!packInCollection[pack])
  ) {
    return card.deck_limit || 0;
  }
  const coreCopies = getPackCopies('core', packInCollection, packQuantities) * (card.quantity || 0) + manualTotal;
  return Math.min(Math.max(0, coreCopies), card.deck_limit || 0);
}

