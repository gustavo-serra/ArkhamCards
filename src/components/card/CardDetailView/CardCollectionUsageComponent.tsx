import React, { useCallback, useContext, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigation } from '@react-navigation/native';
import { forEach, map } from 'lodash';
import { t } from 'ttag';

import Card from '@data/types/Card';
import { CardPrintingSourceBreakdown, getCardPrintingBreakdown } from '@data/types/cardHelpers';
import { CardPhysicalHolder, useCardPhysicalAllocation } from '@components/deck/usePhysicalCollectionTracker';
import {
  getAllPacks,
  getCardPrintingOverrides,
  getPackQuantities,
  getPacksInCollection,
  getPhysicalCollectionMode,
} from '@reducers';
import { setCardPrintingOverride } from '@actions';
import CardDetailSectionHeader from './CardDetailSectionHeader';
import StyleContext from '@styles/StyleContext';
import space, { m, s, xs } from '@styles/space';
import EncounterIcon from '@icons/EncounterIcon';

interface Props {
  card: Card;
  width?: number;
}

interface PrintingSourceRowProps {
  canonicalCode: string;
  source: CardPrintingSourceBreakdown;
  packName: string;
}

function PrintingSourceRow({ canonicalCode, source, packName }: PrintingSourceRowProps) {
  const dispatch = useDispatch();
  const { colors, typography } = useContext(StyleContext);

  const onDecrement = useCallback(() => {
    const nextTotal = Math.max(0, source.totalCopies - 1);
    const nextDelta = nextTotal - source.baseCopies;
    dispatch(setCardPrintingOverride(canonicalCode, source.packCode, nextDelta));
  }, [dispatch, canonicalCode, source.packCode, source.totalCopies, source.baseCopies]);

  const onIncrement = useCallback(() => {
    const nextTotal = source.totalCopies + 1;
    const nextDelta = nextTotal - source.baseCopies;
    dispatch(setCardPrintingOverride(canonicalCode, source.packCode, nextDelta));
  }, [dispatch, canonicalCode, source.packCode, source.totalCopies, source.baseCopies]);

  const onReset = useCallback(() => {
    dispatch(setCardPrintingOverride(canonicalCode, source.packCode, 0));
  }, [dispatch, canonicalCode, source.packCode]);

  const hasOverride = source.manualDelta !== 0;
  const baseCopies = source.baseCopies;
  const packsOwned = source.packsOwned;
  const quantityPerPack = source.quantityPerPack;

  return (
    <View style={[styles.printingRow, { borderBottomColor: colors.L10 }]}>
      <View style={styles.printingInfo}>
        <View style={styles.packTitleRow}>
          <View style={space.marginRightXs}>
            <EncounterIcon encounter_code={source.packCode} size={16} color={colors.D20} pack />
          </View>
          <Text style={[typography.text, typography.bold, styles.flexText]} numberOfLines={2}>
            { packName }
          </Text>
        </View>
        <View style={styles.packSubRow}>
          <Text style={[typography.small, { color: colors.D10 }]}>
            { t`${packsOwned}x pack (${quantityPerPack} per pack = ${baseCopies})` }
          </Text>
          { hasOverride && (
            <TouchableOpacity
              onPress={onReset}
              style={[styles.resetBadge, { borderColor: colors.M, backgroundColor: colors.L20 }]}
            >
              <Text style={[typography.tiny, typography.bold, { color: colors.D20 }]}>
                { t`Default (${baseCopies})` }
              </Text>
            </TouchableOpacity>
          ) }
        </View>
      </View>
      <View style={styles.stepperContainer}>
        <TouchableOpacity
          onPress={onDecrement}
          disabled={source.totalCopies <= 0}
          style={[
            styles.stepButton,
            {
              borderColor: colors.M,
              backgroundColor: colors.L20,
              opacity: source.totalCopies <= 0 ? 0.4 : 1,
            },
          ]}
          accessibilityLabel={t`Decrease copies of ${packName}`}
        >
          <Text style={[typography.text, typography.bold, { color: colors.darkText }]}>-</Text>
        </TouchableOpacity>
        <Text
          style={[
            typography.text,
            typography.bold,
            styles.countValue,
            { color: hasOverride ? colors.warn : colors.darkText },
          ]}
        >
          { source.totalCopies }
        </Text>
        <TouchableOpacity
          onPress={onIncrement}
          style={[
            styles.stepButton,
            {
              borderColor: colors.M,
              backgroundColor: colors.L20,
            },
          ]}
          accessibilityLabel={t`Increase copies of ${packName}`}
        >
          <Text style={[typography.text, typography.bold, { color: colors.darkText }]}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

interface HolderRowProps {
  holder: CardPhysicalHolder;
}

function HolderRow({ holder }: HolderRowProps) {
  const navigation = useNavigation();
  const { colors, typography } = useContext(StyleContext);

  const onPress = useCallback(() => {
    navigation.navigate('Deck', {
      id: holder.deckId,
      campaignId: holder.campaignId,
      modal: true,
    });
  }, [navigation, holder.deckId, holder.campaignId]);

  const campaignLabel = holder.campaignName || t`Standalone`;
  const physicalCount = holder.physicalCopies;
  const heldCount = holder.heldCopies;
  const targetCount = holder.targetCopies;
  const borrowedCount = holder.borrowedCopies;
  const borrowedDecksLabel = holder.borrowedByDecks.join(', ');

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.holderRow, { borderColor: colors.L10, backgroundColor: colors.L20 }]}
    >
      <View style={styles.holderTopRow}>
        <View style={styles.holderTitleBlock}>
          <Text style={[typography.text, typography.bold, { color: colors.darkText }]} numberOfLines={1}>
            { holder.deckName }
          </Text>
          <Text style={[typography.small, { color: colors.D10 }]} numberOfLines={1}>
            { campaignLabel }
          </Text>
        </View>
        <View
          style={[
            styles.deckboxPill,
            {
              backgroundColor: borrowedCount > 0 ? colors.warn : colors.L10,
            },
          ]}
        >
          <Text
            style={[
              typography.small,
              typography.bold,
              { color: borrowedCount > 0 ? colors.D30 : colors.darkText },
            ]}
          >
            { t`${heldCount}/${physicalCount}x in Deckbox` }
          </Text>
        </View>
      </View>
      { borrowedCount > 0 && (
        <View style={[styles.warningRow, { backgroundColor: colors.L10 }]}>
          <Text style={[typography.small, typography.bold, { color: colors.red }]}>
            { borrowedDecksLabel.length > 0
              ? t`⚠️ Borrowed (${borrowedCount}x) by: ${borrowedDecksLabel}`
              : t`⚠️ Borrowed / Missing (${borrowedCount}x)` }
          </Text>
        </View>
      ) }
      { holder.hasPendingUpgrade && (
        <View style={[styles.upgradeBadge, { borderColor: colors.M }]}>
          <Text style={[typography.small, { color: colors.D20 }]}>
            { t`🔄 Pending physical upgrade (${physicalCount}x -> ${targetCount}x)` }
          </Text>
        </View>
      ) }
    </TouchableOpacity>
  );
}

export default function CardCollectionUsageComponent({ card, width }: Props) {
  const dispatch = useDispatch();
  const { colors, typography } = useContext(StyleContext);
  const inCollection = useSelector(getPacksInCollection);
  const packQuantities = useSelector(getPackQuantities);
  const printingOverrides = useSelector(getCardPrintingOverrides);
  const allPacks = useSelector(getAllPacks);
  const mode = useSelector(getPhysicalCollectionMode);
  const allocation = useCardPhysicalAllocation(card);

  const packNamesMap = useMemo(() => {
    const mapByCode: { [code: string]: string | undefined } = {};
    forEach(allPacks, pack => {
      mapByCode[pack.code] = pack.name;
    });
    return mapByCode;
  }, [allPacks]);

  const breakdown = useMemo(
    () => getCardPrintingBreakdown(card, inCollection, packQuantities, printingOverrides, packNamesMap),
    [card, inCollection, packQuantities, printingOverrides, packNamesMap]
  );

  const extraCopies = Math.max(0, breakdown.extraManualDelta);

  const onDecrementExtra = useCallback(() => {
    const nextExtra = Math.max(0, extraCopies - 1);
    dispatch(setCardPrintingOverride(breakdown.canonicalCode, 'extra', nextExtra));
  }, [dispatch, breakdown.canonicalCode, extraCopies]);

  const onIncrementExtra = useCallback(() => {
    const nextExtra = extraCopies + 1;
    dispatch(setCardPrintingOverride(breakdown.canonicalCode, 'extra', nextExtra));
  }, [dispatch, breakdown.canonicalCode, extraCopies]);

  const onResetExtra = useCallback(() => {
    dispatch(setCardPrintingOverride(breakdown.canonicalCode, 'extra', 0));
  }, [dispatch, breakdown.canonicalCode]);

  const totalOwned = allocation ? allocation.totalOwned : breakdown.totalOwned;
  const inBinder = allocation ? allocation.inBinder : breakdown.totalOwned;
  const totalAllocated = allocation ? allocation.totalAllocated : 0;
  const conflictCount = allocation ? allocation.conflictCount : 0;

  return (
    <View style={[styles.container, width ? { width } : undefined]}>
      <CardDetailSectionHeader title={t`Physical Collection & Where to Find`} />

      <View style={[styles.cardBox, { borderColor: colors.L10, backgroundColor: colors.background }]}>
        {/* Header Summary */}
        <View style={[styles.summaryRow, { backgroundColor: colors.L20, borderColor: colors.L10 }]}>
          <View style={styles.summaryStat}>
            <Text style={[typography.small, { color: colors.D10 }]}>
              { t`Total in Collection` }
            </Text>
            <Text style={[typography.large, typography.bold, { color: colors.darkText }]}>
              { `${totalOwned}x` }
            </Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.L10 }]} />
          <View style={styles.summaryStat}>
            <Text style={[typography.small, { color: colors.D10 }]}>
              { t`In Binder` }
            </Text>
            <Text
              style={[
                typography.large,
                typography.bold,
                { color: inBinder > 0 ? colors.green : colors.D20 },
              ]}
            >
              { `${inBinder}x` }
            </Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.L10 }]} />
          <View style={styles.summaryStat}>
            <Text style={[typography.small, { color: colors.D10 }]}>
              { t`In Decks` }
            </Text>
            <Text style={[typography.large, typography.bold, { color: colors.darkText }]}>
              { `${totalAllocated}x` }
            </Text>
          </View>
        </View>

        { conflictCount > 0 && (
          <View style={[styles.conflictBanner, { backgroundColor: colors.warn }]}>
            <Text style={[typography.small, typography.bold, { color: colors.D30 }]}>
              { t`⚠️ Missing ${conflictCount} physical copies` }
            </Text>
          </View>
        ) }

        {/* Breakdown by Pack / Printing */}
        <View style={styles.subSection}>
          <Text style={[typography.small, typography.bold, typography.uppercase, { color: colors.D10 }, space.marginBottomXs]}>
            { t`Inventory by Pack / Printing` }
          </Text>
          { map(breakdown.sources, source => {
            const packName = source.packName || packNamesMap[source.packCode] || source.packCode.toUpperCase();
            return (
              <PrintingSourceRow
                key={source.packCode}
                canonicalCode={breakdown.canonicalCode}
                source={source}
                packName={packName}
              />
            );
          }) }

          {/* Singles / Extras / Proxies */}
          <View style={[styles.printingRow, styles.extraRow, { borderBottomColor: colors.L10 }]}>
            <View style={styles.printingInfo}>
              <Text style={[typography.text, typography.bold, { color: colors.darkText }]}>
                { t`Singles / Extras / Proxies` }
              </Text>
              <View style={styles.packSubRow}>
                <Text style={[typography.small, { color: colors.D10 }]}>
                  { t`Extra copies outside of packs` }
                </Text>
                { extraCopies > 0 && (
                  <TouchableOpacity
                    onPress={onResetExtra}
                    style={[styles.resetBadge, { borderColor: colors.M, backgroundColor: colors.L20 }]}
                  >
                    <Text style={[typography.tiny, typography.bold, { color: colors.D20 }]}>
                      { t`Clear` }
                    </Text>
                  </TouchableOpacity>
                ) }
              </View>
            </View>
            <View style={styles.stepperContainer}>
              <TouchableOpacity
                onPress={onDecrementExtra}
                disabled={extraCopies <= 0}
                style={[
                  styles.stepButton,
                  {
                    borderColor: colors.M,
                    backgroundColor: colors.L20,
                    opacity: extraCopies <= 0 ? 0.4 : 1,
                  },
                ]}
                accessibilityLabel={t`Decrease extra copies`}
              >
                <Text style={[typography.text, typography.bold, { color: colors.darkText }]}>-</Text>
              </TouchableOpacity>
              <Text
                style={[
                  typography.text,
                  typography.bold,
                  styles.countValue,
                  { color: extraCopies > 0 ? colors.warn : colors.darkText },
                ]}
              >
                { extraCopies }
              </Text>
              <TouchableOpacity
                onPress={onIncrementExtra}
                style={[
                  styles.stepButton,
                  {
                    borderColor: colors.M,
                    backgroundColor: colors.L20,
                  },
                ]}
                accessibilityLabel={t`Increase extra copies`}
              >
                <Text style={[typography.text, typography.bold, { color: colors.darkText }]}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Where are my copies right now? */}
        { mode !== 'disabled' && !!allocation && (
          <View style={styles.subSection}>
            <Text style={[typography.small, typography.bold, typography.uppercase, { color: colors.D10 }, space.marginBottomXs]}>
              { t`Where are my copies right now?` }
            </Text>
            <View style={[styles.binderRow, { backgroundColor: colors.L20, borderColor: colors.L10 }]}>
              <Text style={[typography.text, typography.bold, { color: colors.darkText }]}>
                { t`📦 In Binder / Box: ${inBinder}x` }
              </Text>
            </View>
            { allocation.holders.length > 0 ? (
              map(allocation.holders, holder => (
                <HolderRow key={holder.deckKey} holder={holder} />
              ))
            ) : (
              <Text style={[typography.small, { color: colors.D10 }, space.marginTopXs]}>
                { t`No assembled deck is currently using this card.` }
              </Text>
            ) }
          </View>
        ) }
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 768,
    paddingHorizontal: s,
    marginTop: s,
    marginBottom: m,
  },
  cardBox: {
    marginTop: s,
    borderWidth: 1,
    borderRadius: 8,
    padding: s,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: s,
    paddingHorizontal: xs,
  },
  summaryStat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryDivider: {
    width: 1,
    height: '80%',
  },
  conflictBanner: {
    marginTop: s,
    paddingVertical: xs,
    paddingHorizontal: s,
    borderRadius: 6,
    alignItems: 'center',
  },
  subSection: {
    marginTop: m,
  },
  printingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  extraRow: {
    borderBottomWidth: 0,
  },
  printingInfo: {
    flex: 1,
    paddingRight: s,
  },
  packTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flexText: {
    flex: 1,
  },
  packSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  resetBadge: {
    marginLeft: s,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepButton: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countValue: {
    minWidth: 28,
    textAlign: 'center',
    marginHorizontal: xs,
  },
  binderRow: {
    paddingVertical: s,
    paddingHorizontal: s,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: xs,
  },
  holderRow: {
    padding: s,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: xs,
  },
  holderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  holderTitleBlock: {
    flex: 1,
    paddingRight: s,
  },
  deckboxPill: {
    paddingHorizontal: s,
    paddingVertical: 4,
    borderRadius: 12,
  },
  warningRow: {
    marginTop: xs,
    paddingVertical: 4,
    paddingHorizontal: s,
    borderRadius: 4,
  },
  upgradeBadge: {
    marginTop: xs,
    paddingVertical: 3,
    paddingHorizontal: s,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
});
