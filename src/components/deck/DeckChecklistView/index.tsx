import React, { useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { Text, View, StyleSheet, ScrollView } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { t } from 'ttag';
import { useKeepAwake } from 'expo-keep-awake';
import { find, groupBy, map } from 'lodash';

import { TouchableOpacity } from '@components/core/Touchables';
import { Slots, SortType, DeckId, CampaignId } from '@actions/types';
import { confirmPhysicalDeckAssembly, disassemblePhysicalDeck, setDeckPhysicalTracking } from '@actions';
import { AppState, getCardSort } from '@reducers';
import { resetDeckChecklist } from '@components/deck/actions';
import CardSearchResult from '@components/cardlist/CardSearchResult';
import DbCardResultList from '@components/cardlist/CardSearchResultsComponent/DbCardResultList';
import { useSortDialog } from '@components/cardlist/CardSortDialog';
import { CardsMap, InvestigatorChoice } from '@data/types/Card';
import COLORS from '@styles/colors';
import space, { m, s, xs } from '@styles/space';
import StyleContext from '@styles/StyleContext';
import { ParsedDeckResults, useParsedDeck } from '@components/deck/hooks';
import { useInvestigatorChoice } from '@components/card/useSingleCard';
import { useCampaignDeck } from '@data/hooks';
import { NOTCH_BOTTOM_PADDING } from '@styles/sizes';
import { updateCardSorts } from '@components/filter/actions';
import { DeckEditContext, ParsedDeckContextProvider, useChecklistCount, useDeckSlotCount } from '../DeckEditContext';
import { RootStackParamList } from '@navigation/types';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import HeaderButton from '@components/core/HeaderButton';
import { ListCard } from '@data/types/ListCard';
import {
  ChecklistCardQuantity,
  ChecklistRetrieveItem,
  getSafeDeckUuid,
  useDeckPhysicalChecklistPlan,
} from '@components/deck/usePhysicalCollectionTracker';
import LatestDeckT from '@data/interfaces/LatestDeckT';

export interface DeckChecklistProps {
  id: DeckId;
  slots: Slots;
  campaignId?: CampaignId;
  tabooSetOverride?: number;
}

function formatChecklistCardName(code: string, cardsMap: CardsMap): string {
  const card = cardsMap[code];
  if (!card) {
    return code;
  }
  const xpSuffix = card.xp && card.xp > 0 ? ` (${card.xp})` : '';
  return `${card.name}${xpSuffix}`;
}

function ChecklistSectionBlock({
  title,
  items,
  cardsMap,
  emptyText,
}: {
  title: string;
  items: ChecklistCardQuantity[];
  cardsMap: CardsMap;
  emptyText: string;
}) {
  const { typography, colors } = useContext(StyleContext);
  return (
    <View style={[styles.guideSection, { borderColor: colors.L10 }]}>
      <Text style={[typography.small, typography.bold, { color: colors.darkText }]}>
        { title } ({ items.reduce((acc, item) => acc + item.count, 0) })
      </Text>
      { items.length === 0 ? (
        <Text style={[typography.small, { color: colors.M, marginTop: 2 }]}>
          { emptyText }
        </Text>
      ) : (
        map(items, item => (
          <Text key={item.code} style={[typography.small, { color: colors.darkText, marginTop: 2 }]}>
            • { item.count }x { formatChecklistCardName(item.code, cardsMap) }
          </Text>
        ))
      ) }
    </View>
  );
}

function ChecklistRetrieveSectionBlock({
  items,
  cardsMap,
}: {
  items: ChecklistRetrieveItem[];
  cardsMap: CardsMap;
}) {
  const { typography, colors } = useContext(StyleContext);
  const grouped = useMemo(() => {
    return groupBy(items, item =>
      item.fromCampaignName
        ? `${item.fromDeckName} (${item.fromCampaignName})`
        : item.fromDeckName
    );
  }, [items]);
  const totalCount = useMemo(() => items.reduce((acc, item) => acc + item.count, 0), [items]);

  return (
    <View style={[styles.guideSection, { borderColor: colors.L10 }]}>
      <Text style={[typography.small, typography.bold, { color: colors.darkText }]}>
        { t`🔄 Retrieve from Other Decks` } ({ totalCount })
      </Text>
      { items.length === 0 ? (
        <Text style={[typography.small, { color: colors.M, marginTop: 2 }]}>
          { t`No cards need to be retrieved from another deck.` }
        </Text>
      ) : (
        map(grouped, (groupItems, sourceLabel) => (
          <View key={sourceLabel} style={space.marginTopXs}>
            <Text style={[typography.small, typography.bold, { color: colors.M }]}>
              { t`From:` } { sourceLabel }
            </Text>
            { map(groupItems, item => (
              <Text
                key={`${item.fromDeckKey}-${item.code}`}
                style={[typography.small, { color: colors.darkText, marginLeft: s, marginTop: 1 }]}
              >
                • { item.count }x { formatChecklistCardName(item.code, cardsMap) }
              </Text>
            )) }
          </View>
        ))
      ) }
    </View>
  );
}

function ChecklistCard({
  id,
  card,
  pressCard,
}: {
  id: string;
  card: ListCard;
  pressCard: (code: string, card: ListCard) => void;
}) {
  const { checklist, toggleValue } = useChecklistCount(card.code);
  const [count] = useDeckSlotCount(card.code);
  return (
    <CardSearchResult
      card={card}
      onPressId={pressCard}
      id={id}
      backgroundColor="transparent"
      control={{
        type: 'count_with_toggle',
        count,
        values: checklist,
        toggleValue,
      }}
    />
  );
}

function DeckChecklistView({
  id,
  campaignId,
  parsedDeck,
  campaignDeck,
  routeSlots,
  investigator,
}: {
  id: DeckId;
  campaignId?: CampaignId;
  parsedDeck: ParsedDeckResults;
  campaignDeck: LatestDeckT | undefined;
  routeSlots: Slots | undefined;
  investigator: InvestigatorChoice | undefined;
}) {
  const navigation = useNavigation();
  const { backgroundStyle, colors, typography, fontScale, width } = useContext(StyleContext);
  const { checklist } = useContext(DeckEditContext);
  const [guideExpanded, setGuideExpanded] = useState(false);

  const dispatch = useDispatch();
  const effectiveDeckId = campaignDeck?.id || id;
  const currentSlots =
    parsedDeck.deckEdits?.slots ??
    parsedDeck.deck?.slots ??
    campaignDeck?.deck.slots ??
    routeSlots;
  const { plan, cardsMap } = useDeckPhysicalChecklistPlan(effectiveDeckId, currentSlots, parsedDeck.cards);
  const effectiveDeckKey = plan.deckKey || getSafeDeckUuid(effectiveDeckId);

  const handleConfirmAssembly = useCallback(() => {
    if (!effectiveDeckKey) {
      return;
    }
    dispatch(
      confirmPhysicalDeckAssembly({
        deckKey: effectiveDeckKey,
        campaignId: campaignId || campaignDeck?.campaign?.id,
        campaignName: campaignDeck?.campaign?.name,
        investigatorCode:
          parsedDeck.deck?.investigator_code ||
          campaignDeck?.investigator ||
          investigator?.front.code ||
          '',
        deckId: effectiveDeckId,
        deckName:
          parsedDeck.deckEdits?.nameChange ||
          parsedDeck.deck?.name ||
          campaignDeck?.name,
        physicalSlots: currentSlots ?? {},
        assembledAt: new Date().toISOString(),
      })
    );
  }, [
    dispatch,
    effectiveDeckKey,
    campaignId,
    campaignDeck,
    parsedDeck.deck?.investigator_code,
    parsedDeck.deck?.name,
    parsedDeck.deckEdits?.nameChange,
    investigator?.front.code,
    effectiveDeckId,
    currentSlots,
  ]);

  const handleDisassemble = useCallback(() => {
    if (!effectiveDeckKey) {
      return;
    }
    dispatch(
      setDeckPhysicalTracking({
        deckKey: effectiveDeckKey,
        tracked: true,
        campaignId: campaignId || campaignDeck?.campaign?.id,
        investigatorCode:
          parsedDeck.deck?.investigator_code ||
          campaignDeck?.investigator ||
          investigator?.front.code ||
          '',
        deckId: effectiveDeckId,
      })
    );
    dispatch(disassemblePhysicalDeck(effectiveDeckKey));
  }, [
    dispatch,
    effectiveDeckKey,
    campaignId,
    campaignDeck,
    parsedDeck.deck?.investigator_code,
    investigator?.front.code,
    effectiveDeckId,
  ]);

  const toggleGuide = useCallback(() => {
    setGuideExpanded(prev => !prev);
  }, []);

  const sortSelector = useCallback((state: AppState) => getCardSort(state, 'checklist', false), []);
  const sorts = useSelector(sortSelector);
  const setSorts = useCallback((sorts: SortType[]) => {
    dispatch(updateCardSorts(sorts, 'checklist', false));
  }, [dispatch]);
  const hasCheckedItems = useMemo(() => {
    return !!checklist && !!find(Object.values(checklist), f => !!f?.length);
  }, [checklist]);
  const [sortDialog, showSortDialog] = useSortDialog(setSorts, sorts, false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderButton
          iconName="sort"
          color={COLORS.white}
          accessibilityLabel={t`Sort`}
          onPress={showSortDialog}
        />
      ),
    });
  }, [navigation, showSortDialog]);

  const renderCard = useCallback((card: ListCard, cardId: string, onPressId: (id: string, card: ListCard) => void) => {
    return (
      <ChecklistCard
        key={card.code}
        id={cardId}
        card={card}
        pressCard={onPressId}
      />
    );
  }, []);

  const clearChecklist = useCallback(() => {
    dispatch(resetDeckChecklist(effectiveDeckId));
  }, [dispatch, effectiveDeckId]);

  const [headerItems, headerHeight] = useMemo(() => {
    return [
      [(
        <View style={[space.paddingM, styles.headerRow, { width }]} key="header">
          <TouchableOpacity onPress={clearChecklist} disabled={!hasCheckedItems}>
            <Text style={[typography.text, hasCheckedItems ? typography.light : { color: colors.L10 }]}>
              { t`Clear` }
            </Text>
          </TouchableOpacity>
        </View>
      )],
      m * 2 + 22 * fontScale,
    ];
  }, [hasCheckedItems, typography, colors, fontScale, clearChecklist, width]);
  useKeepAwake();

  const statusText = useMemo(() => {
    if (!plan.assembled) {
      return t`📦 Deck not yet physically assembled`;
    }
    if (plan.hasPendingUpgrade) {
      return t`🔄 Pending Physical Upgrade (Deckbox out of date)`;
    }
    return t`✅ Physically Assembled in Deckbox`;
  }, [plan.assembled, plan.hasPendingUpgrade]);

  return (
    <View style={[backgroundStyle, { flex: 1 }]}>
      <View style={[styles.assistantPanel, { backgroundColor: colors.L20, borderBottomColor: colors.L10 }]}>
        <Text style={[typography.small, typography.bold, { color: colors.darkText }]}>
          { t`Physical Collection Assistant (Deckbox)` }
        </Text>
        <Text style={[typography.small, { color: colors.M, marginTop: 2 }]}>
          { statusText }
        </Text>
        <View style={[styles.actionButtonsRow, space.marginTopXs]}>
          { !plan.assembled && (
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.M }]}
              onPress={handleConfirmAssembly}
            >
              <Text style={[typography.small, typography.bold, { color: COLORS.white }]}>
                { t`Confirm Physical Assembly` }
              </Text>
            </TouchableOpacity>
          ) }
          { plan.assembled && plan.hasPendingUpgrade && (
            <>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.upgrade }]}
                onPress={handleConfirmAssembly}
              >
                <Text style={[typography.small, typography.bold, { color: COLORS.D30 }]}>
                  { t`Confirm Card Swap (Update Deckbox)` }
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: colors.M }]}
                onPress={handleDisassemble}
              >
                <Text style={[typography.small, { color: colors.darkText }]}>
                  { t`Disassemble Deck` }
                </Text>
              </TouchableOpacity>
            </>
          ) }
          { plan.assembled && !plan.hasPendingUpgrade && (
            <>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.M }]}
                onPress={handleConfirmAssembly}
              >
                <Text style={[typography.small, typography.bold, { color: COLORS.white }]}>
                  { t`Update Physical Possession (Reclaim Borrowed)` }
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: colors.M }]}
                onPress={handleDisassemble}
              >
                <Text style={[typography.small, { color: colors.darkText }]}>
                  { t`Disassemble Deck (Return to Binder)` }
                </Text>
              </TouchableOpacity>
            </>
          ) }
        </View>
        <TouchableOpacity style={styles.toggleGuideButton} onPress={toggleGuide}>
          <Text style={[typography.small, typography.bold, { color: colors.M }]}>
            { guideExpanded
              ? t`▲ Hide Physical Assembly / Swap Guide`
              : t`▼ View Physical Assembly / Swap Guide` }
          </Text>
        </TouchableOpacity>
        { guideExpanded && (
          <ScrollView style={styles.guideScroll} nestedScrollEnabled>
            <ChecklistSectionBlock
              title={t`📤 Remove from Deckbox (Return to Binder)`}
              items={plan.toReturnToBinder}
              cardsMap={cardsMap}
              emptyText={t`No cards need to be returned to the binder.`}
            />
            <ChecklistRetrieveSectionBlock
              items={plan.toRetrieveFromOtherDecks}
              cardsMap={cardsMap}
            />
            <ChecklistSectionBlock
              title={t`📦 Take from Binder / Box`}
              items={plan.toTakeFromBinder}
              cardsMap={cardsMap}
              emptyText={t`No cards need to be taken from the binder.`}
            />
            <ChecklistSectionBlock
              title={t`✅ Already in Deckbox`}
              items={plan.alreadyInDeckbox}
              cardsMap={cardsMap}
              emptyText={t`No cards from this deck are in the deckbox yet.`}
            />
            { plan.missingFromCollection.length > 0 && (
              <ChecklistSectionBlock
                title={t`⚠️ Missing from Physical Collection`}
                items={plan.missingFromCollection}
                cardsMap={cardsMap}
                emptyText=""
              />
            ) }
          </ScrollView>
        ) }
      </View>
      <DbCardResultList
        deck={parsedDeck.deckT || campaignDeck}
        filterId={effectiveDeckId.uuid}
        investigator={investigator}
        sorts={sorts}
        headerItems={headerItems}
        headerHeight={headerHeight}
        renderCard={renderCard}
        noSearch
        specialMode="checklist"
        currentDeckOnly
        footerPadding={NOTCH_BOTTOM_PADDING}
      />
      { sortDialog }
    </View>
  );
}

function DeckChecklistViewWrapper() {
  const route = useRoute<RouteProp<RootStackParamList, 'Deck.Checklist'>>();
  const { campaignId, id, slots } = route.params;

  const deck = useCampaignDeck(id, campaignId);
  const parsedDeck = useParsedDeck(id);
  const deckEdits = parsedDeck?.deckEdits;
  const investigator = useInvestigatorChoice(deck?.investigator, deckEdits?.meta, deckEdits?.tabooSetChange || deck?.deck.taboo_id);

  return (
    <ParsedDeckContextProvider parsedDeckObj={parsedDeck}>
      <DeckChecklistView
        id={id}
        campaignId={campaignId}
        parsedDeck={parsedDeck}
        campaignDeck={deck}
        routeSlots={slots}
        investigator={investigator}
      />
    </ParsedDeckContextProvider>
  );
}

export default DeckChecklistViewWrapper;

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  assistantPanel: {
    paddingHorizontal: m,
    paddingVertical: s,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: xs,
  },
  primaryButton: {
    paddingHorizontal: s,
    paddingVertical: xs,
    borderRadius: 6,
    marginRight: xs,
    marginBottom: xs,
  },
  secondaryButton: {
    paddingHorizontal: s,
    paddingVertical: xs,
    borderRadius: 6,
    borderWidth: 1,
    marginRight: xs,
    marginBottom: xs,
  },
  toggleGuideButton: {
    paddingVertical: xs,
  },
  guideScroll: {
    maxHeight: 240,
    marginTop: xs,
  },
  guideSection: {
    paddingVertical: xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
