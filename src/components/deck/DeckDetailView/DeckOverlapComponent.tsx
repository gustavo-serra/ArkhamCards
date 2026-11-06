import React, { useMemo, useCallback, useContext, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Text, View, StyleSheet } from 'react-native';
import { find, forEach, findIndex, map, groupBy, values, flatMap, sumBy, keys } from 'lodash';
import { t, ngettext, msgid } from 'ttag';

import { RANDOM_BASIC_WEAKNESS } from '@app_constants';
import { CampaignId, getDeckId, ParsedDeck, Slots } from '@actions/types';
import {
  confirmPhysicalDeckAssembly,
  disassemblePhysicalDeck,
  setDeckPhysicalTracking,
} from '@actions';
import { useCampaignGuideContext } from '@components/campaignguide/withCampaignGuideContext';
import { useFlag, useSettingValue, useToggles } from '@components/core/hooks';
import {
  getAllDecks,
  getAssembledDecks,
  getCardPrintingOverrides,
  getPackQuantities,
  getPacksInCollection,
} from '@reducers';
import Card, { CardsMap } from '@data/types/Card';
import { calculateCardCollectionQuantity, getCanonicalCardCode } from '@data/types/cardHelpers';
import DeckSectionBlock from '../section/DeckSectionBlock';
import CardSearchResult from '@components/cardlist/CardSearchResult';
import LatestDeckT from '@data/interfaces/LatestDeckT';
import { showCard, showCardSwipe } from '@components/nav/helper';
import StyleContext from '@styles/StyleContext';
import DeckBubbleHeader from '../section/DeckBubbleHeader';
import space, { s, xs } from '@styles/space';
import COLORS from '@styles/colors';
import InvestigatorImageButton from '@components/core/InvestigatorImageButton';
import { TouchableOpacity } from '@components/core/Touchables';
import SingleCampaignT from '@data/interfaces/SingleCampaignT';
import { CampaignInvestigator } from '@data/scenario/GuidedCampaignLog';
import { useNavigation } from '@react-navigation/native';
import {
  resolveCanonicalDeckKey,
  resolveDeckByKeyOrId,
  usePhysicalCollectionAllocations,
} from '@components/deck/usePhysicalCollectionTracker';

interface Props {
  parsedDeck?: ParsedDeck;
  campaignId: CampaignId;
  live: boolean;
  cards: CardsMap;
}

interface OverlapSection {
  sectionKey: string;
  sectionTitle?: string;
  investigator?: Card;
  deck?: LatestDeckT;
  conflicts: {
    id: string;
    card: Card;
    count: number;
  }[];
}

interface ParticipatingDeckEntry {
  key: string;
  investigatorCode: string;
  investigatorCard?: Card;
  label: string;
  slots: Slots;
  latestDeck?: LatestDeckT;
}

function OverlapSectionComponent({
  overlap: { investigator, sectionTitle, conflicts },
  onPressId,
}: {
  overlap: OverlapSection;
  onPressId: (code: string, card: Card) => void;
}) {
  const count = sumBy(conflicts, c => c.count);
  const countText = ngettext(msgid`(${count} card)`, `(${count} cards)`, count);
  const headerName = sectionTitle || investigator?.name;
  return (
    <View>
      { !!headerName && (
        <View style={space.paddingSideS}>
          <DeckBubbleHeader title={`— ${headerName} ${countText} —`} />
        </View>
      ) }
      { map(conflicts, overlap => (
        <CardSearchResult
          key={overlap.card.code}
          id={overlap.id}
          card={overlap.card}
          onPressId={onPressId}
          control={{ type: 'count', count: overlap.count }}
        />
      )) }
    </View>
  );
}

export default function DeckOverlapComponent({ parsedDeck, cards, campaignInvestigators, latestDecks, campaign }: {
  parsedDeck?: ParsedDeck;
  cards: CardsMap;
  campaign: SingleCampaignT;
  latestDecks: LatestDeckT[];
  campaignInvestigators: CampaignInvestigator[] | undefined;
}) {
  const { colors, typography } = useContext(StyleContext);
  const dispatch = useDispatch();
  const in_collection = useSelector(getPacksInCollection);
  const packQuantities = useSelector(getPackQuantities);
  const printingOverrides = useSelector(getCardPrintingOverrides);
  const allDecks = useSelector(getAllDecks);
  const assembledDecks = useSelector(getAssembledDecks);
  const { mode, assembledDecksList, cardsMap } = usePhysicalCollectionAllocations(cards);

  const [globalScope, setGlobalScope] = useState<boolean>(mode !== 'disabled');
  const [excludeInvestigators, toggleExcludeInvestigators] = useToggles({});
  const ignore_collection = useSettingValue('ignore_collection');
  const currentInvestigator = parsedDeck?.investigator.front.code;

  const { deckKey: currentDeckKey, state: currentDeckState } = useMemo(
    () => resolveDeckByKeyOrId(parsedDeck?.id, allDecks, assembledDecks),
    [parsedDeck?.id, allDecks, assembledDecks]
  );

  const isCurrentDeckExcluded = currentDeckState?.tracked === false;
  const isCurrentDeckAssembled = useMemo(() => {
    if (!currentDeckKey) {
      return false;
    }
    return !!find(assembledDecksList, d => d.deckKey === currentDeckKey);
  }, [assembledDecksList, currentDeckKey]);

  const handleTogglePhysicalAssembly = useCallback(() => {
    if (!parsedDeck?.id || !currentDeckKey) {
      return;
    }
    if (isCurrentDeckAssembled) {
      dispatch(
        setDeckPhysicalTracking({
          deckKey: currentDeckKey,
          tracked: true,
          campaignId: campaign.id,
          investigatorCode: currentInvestigator || '',
          deckId: parsedDeck.id,
        })
      );
      dispatch(disassemblePhysicalDeck(currentDeckKey));
    } else {
      dispatch(
        confirmPhysicalDeckAssembly({
          deckKey: currentDeckKey,
          campaignId: campaign.id,
          campaignName: campaign.name,
          investigatorCode: currentInvestigator || '',
          deckId: parsedDeck.id,
          deckName: parsedDeck.deck?.name,
          physicalSlots: parsedDeck.slots,
          assembledAt: new Date().toISOString(),
        })
      );
    }
  }, [
    parsedDeck,
    currentDeckKey,
    isCurrentDeckAssembled,
    dispatch,
    campaign.id,
    campaign.name,
    currentInvestigator,
  ]);

  const handleToggleFriendDeck = useCallback(() => {
    if (!parsedDeck?.id || !currentDeckKey) {
      return;
    }
    dispatch(
      setDeckPhysicalTracking({
        deckKey: currentDeckKey,
        tracked: isCurrentDeckExcluded,
        campaignId: campaign.id,
        investigatorCode: currentInvestigator || '',
        deckId: parsedDeck.id,
      })
    );
  }, [
    parsedDeck?.id,
    currentDeckKey,
    isCurrentDeckExcluded,
    dispatch,
    campaign.id,
    currentInvestigator,
  ]);

  const activeDecks = useMemo(() => {
    return flatMap(latestDecks, deck => {
      const investigator = find(campaignInvestigators, i => i.code === deck.investigator);
      if (deck.investigator === currentInvestigator ||
        (!investigator || investigator.card.eliminated(campaign.getInvestigatorData(investigator.code)))) {
        return [];
      }
      const deckKey = resolveCanonicalDeckKey(deck.deck, allDecks, assembledDecks);
      const state = assembledDecks[deckKey] || assembledDecks[getDeckId(deck.deck).uuid];
      if (state?.tracked === false) {
        return [];
      }
      return {
        deckKey,
        deck,
        investigator,
      };
    });
  }, [campaignInvestigators, currentInvestigator, latestDecks, campaign, allDecks, assembledDecks]);

  const participatingDecks = useMemo((): ParticipatingDeckEntry[] => {
    const entries: ParticipatingDeckEntry[] = [];
    const seenDeckKeys = new Set<string>();
    if (currentDeckKey) {
      seenDeckKeys.add(currentDeckKey);
    }

    forEach(activeDecks, ({ deckKey, deck, investigator }) => {
      seenDeckKeys.add(deckKey);
      entries.push({
        key: investigator.code,
        investigatorCode: investigator.code,
        investigatorCard: investigator.card,
        label: investigator.card.name,
        slots: deck.deck.slots || {},
        latestDeck: deck,
      });
    });

    if (globalScope) {
      forEach(assembledDecksList, trackedDeck => {
        if (seenDeckKeys.has(trackedDeck.deckKey)) {
          return;
        }
        if (parsedDeck?.id && trackedDeck.deckId.uuid === parsedDeck.id.uuid) {
          return;
        }
        seenDeckKeys.add(trackedDeck.deckKey);
        const invCard = cardsMap[trackedDeck.investigatorCode] || cards[trackedDeck.investigatorCode];
        const baseName = invCard?.name || trackedDeck.deck.name;
        const label = trackedDeck.campaignName
          ? `${baseName} (${trackedDeck.campaignName})`
          : `${baseName} (${trackedDeck.deck.name})`;
        entries.push({
          key: trackedDeck.deckKey,
          investigatorCode: trackedDeck.investigatorCode,
          investigatorCard: invCard,
          label,
          slots: trackedDeck.physicalSlots,
        });
      });
    }

    return entries;
  }, [activeDecks, globalScope, assembledDecksList, currentDeckKey, parsedDeck?.id, cardsMap, cards]);

  const [overlap] = useMemo((): [OverlapSection[], boolean] => {
    if (!cards || isCurrentDeckExcluded) {
      return [[], true];
    }

    const allCanonicalCounts: { [canonicalCode: string]: number } = {};
    const canonicalSampleCard: { [canonicalCode: string]: Card | undefined } = {};

    if (parsedDeck) {
      forEach(parsedDeck.slots, (qty, code) => {
        if (qty <= 0 || code === RANDOM_BASIC_WEAKNESS) {
          return;
        }
        const card = cardsMap[code] || cards[code];
        const canonicalCode = card ? getCanonicalCardCode(card) : code;
        if (card) {
          canonicalSampleCard[canonicalCode] = card;
        }
        allCanonicalCounts[canonicalCode] = (allCanonicalCounts[canonicalCode] || 0) + qty;
      });
    }

    const canonicalHolders: {
      [canonicalCode: string]: {
        entry: ParticipatingDeckEntry;
        quantity: number;
      }[];
    } = {};

    forEach(participatingDecks, entry => {
      if (excludeInvestigators[entry.key] || excludeInvestigators[entry.investigatorCode]) {
        return;
      }
      const entryCanonicalCounts: { [canonicalCode: string]: number } = {};
      forEach(entry.slots, (quantity, code) => {
        if (quantity <= 0 || code === RANDOM_BASIC_WEAKNESS) {
          return;
        }
        const card = cardsMap[code] || cards[code];
        const canonicalCode = card ? getCanonicalCardCode(card) : code;
        if (card && !canonicalSampleCard[canonicalCode]) {
          canonicalSampleCard[canonicalCode] = card;
        }
        entryCanonicalCounts[canonicalCode] = (entryCanonicalCounts[canonicalCode] || 0) + quantity;
      });

      forEach(entryCanonicalCounts, (quantity, canonicalCode) => {
        if (!parsedDeck || (allCanonicalCounts[canonicalCode] || 0) > 0) {
          allCanonicalCounts[canonicalCode] = (allCanonicalCounts[canonicalCode] || 0) + quantity;
          if (!canonicalHolders[canonicalCode]) {
            canonicalHolders[canonicalCode] = [];
          }
          canonicalHolders[canonicalCode].push({
            entry,
            quantity,
          });
        }
      });
    });

    const overlapItems: {
      card: Card;
      entry?: ParticipatingDeckEntry;
      count: number;
      limit: number;
    }[] = [];

    forEach(allCanonicalCounts, (count, canonicalCode) => {
      const card = canonicalSampleCard[canonicalCode] || cardsMap[canonicalCode] || cards[canonicalCode];
      if (!card || card.code === RANDOM_BASIC_WEAKNESS) {
        return;
      }
      const limit = calculateCardCollectionQuantity(
        card,
        in_collection,
        ignore_collection,
        packQuantities,
        printingOverrides
      );
      if (count > limit) {
        if (parsedDeck) {
          forEach(canonicalHolders[canonicalCode] || [], ({ entry }) => {
            overlapItems.push({
              card,
              entry,
              count,
              limit,
            });
          });
        } else {
          overlapItems.push({ card, count, limit });
        }
      }
    });

    if (parsedDeck) {
      const grouped = groupBy(overlapItems, o => o.entry?.key || '');
      const result: OverlapSection[] = flatMap(values(grouped), g => {
        if (!g.length) {
          return [];
        }
        const firstEntry = g[0].entry;
        return {
          sectionKey: firstEntry?.key || 'default',
          sectionTitle: firstEntry?.label,
          investigator: firstEntry?.investigatorCard,
          deck: firstEntry?.latestDeck,
          conflicts: map(g, o => ({
            id: `${firstEntry?.key} - ${o.card.code}`,
            card: o.card,
            count: o.count - o.limit,
          })),
        };
      });
      return [result, false];
    }

    if (!overlapItems.length) {
      return [[], false];
    }
    const section: OverlapSection = {
      sectionKey: 'default',
      conflicts: map(overlapItems, o => ({
        id: o.card.code,
        card: o.card,
        count: o.count - o.limit,
      })),
    };
    return [[section], false];
  }, [
    cards,
    cardsMap,
    isCurrentDeckExcluded,
    parsedDeck,
    participatingDecks,
    excludeInvestigators,
    in_collection,
    ignore_collection,
    packQuantities,
    printingOverrides,
  ]);

  const [open, toggleOpen] = useFlag(false);
  const singleCardView = useSettingValue('single_card');
  const navigation = useNavigation();
  const showCardPressed = useCallback((id: string, card: Card) => {
    if (singleCardView) {
      showCard(navigation, card.code, card, colors, { showSpoilers: true });
    } else {
      const allCards = flatMap(overlap, o => o.conflicts);
      showCardSwipe(
        navigation,
        colors,
        map(allCards, card => card.card.code),
        {
          controls: undefined,
          index: findIndex(allCards, c => c.id === id),
          initialCards: map(allCards, o => o.card),
          showSpoilers: true,
          tabooSetId: parsedDeck?.deck?.taboo_id,
          investigator: parsedDeck?.investigator.front,
          editable: false,
          initialCustomizations: parsedDeck?.customizations,
        }
      );
    }
  }, [navigation, overlap, colors, parsedDeck, singleCardView]);

  const setCampaignScope = useCallback(() => setGlobalScope(false), []);
  const setGlobalAssembledScope = useCallback(() => setGlobalScope(true), []);

  if (!overlap.length && !keys(excludeInvestigators).length && !(mode !== 'disabled' && !!parsedDeck)) {
    return null;
  }
  return (
    <DeckSectionBlock
      faction={parsedDeck?.faction ?? 'neutral'}
      title={parsedDeck ? t`Collection overlap` : t`Deck overlap`}
      collapsedText={!open ? t`Show collection overlap` : t`Hide collection overlap`}
      collapsed={!open}
      toggleCollapsed={toggleOpen}
      noSpace
    >
      { !!parsedDeck && (
        <View style={[styles.quickActionContainer, space.paddingS, { borderBottomColor: colors.L10 }]}>
          <View style={styles.quickActionRow}>
            <TouchableOpacity
              style={[
                styles.actionBadge,
                {
                  backgroundColor: isCurrentDeckAssembled ? colors.M : colors.L20,
                  borderColor: colors.M,
                },
              ]}
              onPress={handleTogglePhysicalAssembly}
            >
              <Text
                style={[
                  typography.small,
                  typography.bold,
                  { color: isCurrentDeckAssembled ? COLORS.white : colors.darkText },
                ]}
              >
                { isCurrentDeckAssembled
                  ? t`✅ Montado Fisicamente (Desmontar)`
                  : t`📦 Marcar como Montado Fisicamente` }
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionBadge,
                {
                  backgroundColor: isCurrentDeckExcluded ? colors.warn : colors.L20,
                  borderColor: isCurrentDeckExcluded ? colors.warn : colors.L10,
                },
              ]}
              onPress={handleToggleFriendDeck}
            >
              <Text
                style={[
                  typography.small,
                  { color: isCurrentDeckExcluded ? COLORS.white : colors.darkText },
                ]}
              >
                { isCurrentDeckExcluded
                  ? t`🤝 Deck de Amigo (Ignorado na Coleção)`
                  : t`🤝 Deck de Amigo (Não usa minha coleção)` }
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) }
      <View style={[styles.scopeToggleRow, space.paddingS]}>
        <TouchableOpacity
          style={[
            styles.scopeToggleBtn,
            {
              backgroundColor: !globalScope ? colors.M : colors.L20,
              borderColor: colors.M,
            },
          ]}
          onPress={setCampaignScope}
        >
          <Text style={[typography.small, { color: !globalScope ? COLORS.white : colors.darkText }]}>
            { t`Apenas Esta Campanha` }
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.scopeToggleBtn,
            {
              backgroundColor: globalScope ? colors.M : colors.L20,
              borderColor: colors.M,
            },
          ]}
          onPress={setGlobalAssembledScope}
        >
          <Text style={[typography.small, { color: globalScope ? COLORS.white : colors.darkText }]}>
            { t`Todos os Decks Físicos Montados (Global)` }
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={[typography.small, space.paddingS]}>
        { globalScope
          ? t`O total dessas cartas entre os decks desta campanha e seus outros decks físicos montados excede sua coleção.`
          : t`The total number of these cards among decks from this campaign exceeds your card collection.` }
      </Text>
      <View style={[styles.leftRow, space.paddingS, space.paddingBottomM]}>
        { map(participatingDecks, ({ key, investigatorCard }) => (
          !investigatorCard || excludeInvestigators[key] ? null : (
            <View style={space.paddingRightS} key={key}>
              <InvestigatorImageButton
                onPress={() => toggleExcludeInvestigators(key)}
                selected={!excludeInvestigators[key]}
                card={investigatorCard}
                size="tiny"
              />
            </View>
          )
        )) }
        <View style={styles.rightRow}>
          { map(participatingDecks, ({ key, investigatorCard }) => (
            !investigatorCard || !excludeInvestigators[key] ? null : (
              <View style={space.paddingLeftS} key={key}>
                <InvestigatorImageButton
                  onPress={() => toggleExcludeInvestigators(key)}
                  selected={!excludeInvestigators[key]}
                  card={investigatorCard}
                  size="tiny"
                />
              </View>
            )
          )) }
        </View>
      </View>
      { map(overlap, (overlapSection) => (
        <OverlapSectionComponent
          key={overlapSection.sectionKey}
          overlap={overlapSection}
          onPressId={showCardPressed}
        />
      )) }
    </DeckSectionBlock>
  );
}

export function DeckOverlapComponentForCampaign({
  parsedDeck,
  campaignId,
  live,
  cards,
}: Props) {
  const [campaignGuideContext] = useCampaignGuideContext(campaignId, live);
  if (!campaignGuideContext) {
    return null;
  }
  return (
    <DeckOverlapComponent
      parsedDeck={parsedDeck}
      cards={cards}
      campaign={campaignGuideContext.campaign}
      latestDecks={campaignGuideContext.campaign.latestDecks()}
      campaignInvestigators={campaignGuideContext.campaignInvestigators}
    />
  );
}

const styles = StyleSheet.create({
  rightRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flex: 1,
  },
  leftRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  quickActionContainer: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  quickActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: xs,
  },
  actionBadge: {
    paddingHorizontal: s,
    paddingVertical: xs,
    borderRadius: 6,
    borderWidth: 1,
    marginRight: xs,
    marginBottom: xs,
  },
  scopeToggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: xs,
  },
  scopeToggleBtn: {
    paddingHorizontal: s,
    paddingVertical: xs,
    borderRadius: 6,
    borderWidth: 1,
    marginRight: xs,
    marginBottom: xs,
  },
});