import React, { useCallback, useContext, useMemo } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { filter, forEach, map, sortBy, sum, values } from 'lodash';
import { t } from 'ttag';
import { useNavigation } from '@react-navigation/native';

import {
  confirmMultiplePhysicalDecksAssembly,
  confirmPhysicalDeckAssembly,
  disassemblePhysicalDeck,
  setDeckPhysicalTracking,
  setPhysicalCollectionMode,
} from '@actions';
import { PhysicalCollectionMode } from '@actions/types';
import { getAssembledDecks } from '@reducers';
import {
  buildChronologicalOpenCampaignAssemblyEntries,
  CardPhysicalAllocation,
  promptChronologicalOpenCampaignAssembly,
  TrackedPhysicalDeck,
  usePhysicalCollectionAllocations,
  useTrackedPhysicalDecks,
} from '@components/deck/usePhysicalCollectionTracker';
import StyleContext from '@styles/StyleContext';
import space, { s, xs } from '@styles/space';
import RoundedFactionBlock from '@components/core/RoundedFactionBlock';
import DeckSectionHeader from '@components/deck/section/DeckSectionHeader';
import DeckButton from '@components/deck/controls/DeckButton';
import { TouchableOpacity } from '@components/core/Touchables';
import AppIcon from '@icons/AppIcon';
import { showCard } from '@components/nav/helper';

interface ModeOption {
  value: PhysicalCollectionMode;
  title: string;
  description: string;
}

function getModeOptions(): ModeOption[] {
  return [
    {
      value: 'manual',
      title: t`Manual per Deck/Campaign (Default)`,
      description: t`You choose which decks are physically assembled.`,
    },
    {
      value: 'active_campaigns',
      title: t`Active Campaigns`,
      description: t`Automatically tracks all decks in non-archived campaigns.`,
    },
    {
      value: 'all_decks',
      title: t`All Decks`,
      description: t`Treats all your active decks as physically assembled.`,
    },
    {
      value: 'disabled',
      title: t`Disabled`,
      description: t`Hides physical collection warnings and badges.`,
    },
  ];
}

function formatAssembledTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime()) || date.getTime() <= 0) {
    return t`Automatic`;
  }
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PhysicalCollectionManagerView() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const { backgroundStyle, borderStyle, colors, typography } = useContext(StyleContext);
  const assembledDecksState = useSelector(getAssembledDecks);
  const { allTrackedDecks: rawTrackedDecks } = useTrackedPhysicalDecks(true, true);
  const {
    mode,
    assembledDecksList,
    allTrackedDecks,
    allocationsByCanonicalCode,
    cardsMap,
    loading,
  } = usePhysicalCollectionAllocations();

  const openCampaignAssemblyEntries = useMemo(() => {
    return buildChronologicalOpenCampaignAssemblyEntries(rawTrackedDecks, assembledDecksState);
  }, [rawTrackedDecks, assembledDecksState]);

  const borrowedCountByDeckKey = useMemo((): { [deckKey: string]: number | undefined } => {
    const counts: { [deckKey: string]: number | undefined } = {};
    forEach(allocationsByCanonicalCode, alloc => {
      if (!alloc || alloc.conflictCount <= 0) {
        return;
      }
      forEach(alloc.holders, holder => {
        if (holder.borrowedCopies > 0) {
          counts[holder.deckKey] = (counts[holder.deckKey] || 0) + holder.borrowedCopies;
        }
      });
    });
    return counts;
  }, [allocationsByCanonicalCode]);

  const handleAssembleOpenCampaigns = useCallback(() => {
    if (openCampaignAssemblyEntries.length > 0) {
      dispatch(confirmMultiplePhysicalDecksAssembly(openCampaignAssemblyEntries));
    }
  }, [dispatch, openCampaignAssemblyEntries]);

  const handlePromptChronologicalAssembly = useCallback(() => {
    if (openCampaignAssemblyEntries.length > 0) {
      promptChronologicalOpenCampaignAssembly(
        openCampaignAssemblyEntries,
        handleAssembleOpenCampaigns
      );
    }
  }, [openCampaignAssemblyEntries, handleAssembleOpenCampaigns]);

  const handleSelectMode = useCallback((nextMode: PhysicalCollectionMode) => {
    dispatch(setPhysicalCollectionMode(nextMode));
    if (nextMode === 'manual' && openCampaignAssemblyEntries.length > 0) {
      promptChronologicalOpenCampaignAssembly(
        openCampaignAssemblyEntries,
        handleAssembleOpenCampaigns
      );
    }
  }, [dispatch, openCampaignAssemblyEntries, handleAssembleOpenCampaigns]);

  const conflictAllocations = useMemo((): CardPhysicalAllocation[] => {
    const conflicts = filter(
      values(allocationsByCanonicalCode),
      (alloc): alloc is CardPhysicalAllocation => !!alloc && alloc.conflictCount > 0
    );
    return sortBy(conflicts, alloc => {
      const card = cardsMap[alloc.canonicalCode];
      return card?.name || alloc.canonicalCode;
    });
  }, [allocationsByCanonicalCode, cardsMap]);

  const availableDecksList = useMemo((): TrackedPhysicalDeck[] => {
    return filter(allTrackedDecks, d => !d.assembled && !d.isArchivedCampaign);
  }, [allTrackedDecks]);

  const handleConfirmDeckAssembly = useCallback((trackedDeck: TrackedPhysicalDeck) => {
    dispatch(
      confirmPhysicalDeckAssembly({
        deckKey: trackedDeck.deckKey,
        campaignId: trackedDeck.campaignId,
        campaignName: trackedDeck.campaignName,
        investigatorCode: trackedDeck.investigatorCode,
        deckId: trackedDeck.deckId,
        deckName: trackedDeck.deck.name,
        physicalSlots: trackedDeck.targetSlots,
        assembledAt: new Date().toISOString(),
      })
    );
  }, [dispatch]);

  const handleDisassembleDeck = useCallback((deckKey: string) => {
    dispatch(disassemblePhysicalDeck(deckKey));
  }, [dispatch]);

  const handleToggleIgnoreFriendDeck = useCallback((trackedDeck: TrackedPhysicalDeck, currentlyIgnored: boolean) => {
    dispatch(
      setDeckPhysicalTracking({
        deckKey: trackedDeck.deckKey,
        tracked: currentlyIgnored,
        campaignId: trackedDeck.campaignId,
        investigatorCode: trackedDeck.investigatorCode,
        deckId: trackedDeck.deckId,
      })
    );
  }, [dispatch]);

  const handleOpenChecklist = useCallback((trackedDeck: TrackedPhysicalDeck) => {
    navigation.navigate('Deck.Checklist', {
      id: trackedDeck.deckId,
      slots: trackedDeck.targetSlots,
      campaignId: trackedDeck.campaignId,
    });
  }, [navigation]);

  const handlePressCard = useCallback((canonicalCode: string) => {
    const card = cardsMap[canonicalCode];
    if (card) {
      showCard(navigation, canonicalCode, card, colors, { showSpoilers: true });
    }
  }, [navigation, cardsMap, colors]);

  const modeOptions = getModeOptions();
  const conflictCount = conflictAllocations.length;
  const assembledCount = assembledDecksList.length;
  const availableCount = availableDecksList.length;

  return (
    <SafeAreaView style={[styles.container, backgroundStyle]}>
      <ScrollView
        style={[styles.list, { backgroundColor: colors.L10 }]}
        contentContainerStyle={space.paddingBottomM}
        keyboardShouldPersistTaps="always"
      >
        {/* Section 1: Physical Tracking Mode */}
        <View style={[space.paddingSideS, space.paddingTopS, space.paddingBottomS]}>
          <RoundedFactionBlock
            faction="neutral"
            header={<DeckSectionHeader faction="neutral" title={t`Physical Tracking Mode`} />}
          >
            <View style={[space.paddingTopXs, space.paddingBottomXs]}>
              {map(modeOptions, (option, idx) => {
                const selected = mode === option.value;
                const isLast = idx === modeOptions.length - 1;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => handleSelectMode(option.value)}
                  >
                    <View
                      style={[
                        styles.modeRow,
                        space.paddingS,
                        !isLast ? { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.L10 } : undefined,
                        { backgroundColor: selected ? colors.L30 : colors.L20 },
                      ]}
                    >
                      <View style={[styles.radioCircle, { borderColor: selected ? colors.D30 : colors.M }]}>
                        {selected && <View style={[styles.radioInner, { backgroundColor: colors.D30 }]} />}
                      </View>
                      <View style={styles.modeTextColumn}>
                        <Text style={[typography.large, typography.bold, { color: colors.D30 }]}>
                          {option.title}
                        </Text>
                        <Text style={[typography.small, { color: colors.D10, marginTop: 2 }]}>
                          {option.description}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </RoundedFactionBlock>
        </View>

        {loading && (
          <View style={[styles.loadingRow, space.paddingS]}>
            <ActivityIndicator size="small" color={colors.D20} />
            <Text style={[typography.small, space.marginLeftS, { color: colors.D10 }]}>
              {t`Calculating physical allocations...`}
            </Text>
          </View>
        )}

        {mode !== 'disabled' && (
          <>
            {/* Section 2: Active Conflicts & Borrowed Cards */}
            <View style={[space.paddingSideS, space.paddingBottomS]}>
              <RoundedFactionBlock
                faction="neutral"
                header={
                  <DeckSectionHeader
                    faction="neutral"
                    title={t`Active Conflicts & Borrowed Cards (${conflictCount})`}
                  />
                }
              >
                <View style={space.paddingS}>
                  {conflictAllocations.length === 0 ? (
                    <Text style={[typography.text, { color: colors.D10 }]}>
                      {t`✅ No physical conflicts among assembled decks right now.`}
                    </Text>
                  ) : (
                    map(conflictAllocations, (alloc, idx) => {
                      const card = cardsMap[alloc.canonicalCode];
                      const cardName = card?.name || alloc.canonicalCode;
                      const subname = card?.subname;
                      const xp = card?.xp;
                      const holdingDecks = filter(alloc.holders, h => h.heldCopies > 0);
                      const borrowingDecks = filter(alloc.holders, h => h.borrowedCopies > 0);
                      const isLast = idx === conflictAllocations.length - 1;
                      const totalRequested = alloc.totalPhysicalRequested;
                      const totalOwned = alloc.totalOwned;

                      return (
                        <TouchableOpacity
                          key={alloc.canonicalCode}
                          onPress={() => handlePressCard(alloc.canonicalCode)}
                          disabled={!card}
                        >
                          <View
                            style={[
                              styles.cardConflictBox,
                              borderStyle,
                              { backgroundColor: colors.L20 },
                              !isLast ? space.marginBottomS : undefined,
                            ]}
                          >
                            <View style={styles.conflictHeaderRow}>
                              <View style={styles.flex}>
                                <Text style={[typography.cardName, { color: colors.D30 }]}>
                                  {cardName}
                                  {subname ? ` — ${subname}` : ''}
                                  {xp !== undefined && xp > 0 ? ` (${xp})` : ''}
                                </Text>
                              </View>
                              <View style={[styles.conflictBadge, { backgroundColor: colors.warn }]}>
                                <Text style={[typography.small, typography.bold, { color: '#FFFFFF' }]}>
                                  {t`In use: ${totalRequested} / Owned: ${totalOwned}`}
                                </Text>
                              </View>
                            </View>

                            {holdingDecks.length > 0 && (
                              <View style={space.marginTopXs}>
                                <Text style={[typography.small, typography.bold, { color: colors.D20 }]}>
                                  {t`📦 Physical copy currently held by:`}
                                </Text>
                                {map(holdingDecks, holder => (
                                  <Text
                                    key={`held-${holder.deckKey}`}
                                    style={[typography.small, { color: colors.D10, marginLeft: xs }]}
                                  >
                                    {`• ${holder.deckName}${holder.campaignName ? ` (${holder.campaignName})` : ''}: ${holder.heldCopies}x`}
                                  </Text>
                                ))}
                              </View>
                            )}

                            {borrowingDecks.length > 0 && (
                              <View style={space.marginTopXs}>
                                <Text style={[typography.small, typography.bold, { color: colors.warn }]}>
                                  {t`⚠️ Borrowed / Missing in:`}
                                </Text>
                                {map(borrowingDecks, holder => {
                                  const deckLabel = `${holder.deckName}${holder.campaignName ? ` (${holder.campaignName})` : ''}`;
                                  const missingCount = holder.borrowedCopies;
                                  return (
                                    <Text
                                      key={`borrowed-${holder.deckKey}`}
                                      style={[typography.small, { color: colors.D10, marginLeft: xs }]}
                                    >
                                      {t`• ${deckLabel}: missing ${missingCount}x`}
                                    </Text>
                                  );
                                })}
                              </View>
                            )}
                          </View>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              </RoundedFactionBlock>
            </View>

            {/* Section 3: Physically Assembled Decks */}
            <View style={[space.paddingSideS, space.paddingBottomS]}>
              <RoundedFactionBlock
                faction="neutral"
                header={
                  <DeckSectionHeader
                    faction="neutral"
                    title={t`Physically Assembled Decks (${assembledCount})`}
                  />
                }
              >
                <View style={space.paddingS}>
                  {assembledDecksList.length === 0 ? (
                    <Text style={[typography.text, { color: colors.D10 }]}>
                      {t`No decks marked as physically assembled.`}
                    </Text>
                  ) : (
                    map(assembledDecksList, (trackedDeck, idx) => {
                      const investigator = cardsMap[trackedDeck.investigatorCode];
                      const totalPhysicalCards = sum(values(trackedDeck.physicalSlots));
                      const assembledDate = formatAssembledTimestamp(trackedDeck.assembledAt);
                      const missingInDeck = borrowedCountByDeckKey[trackedDeck.deckKey] || 0;
                      const isLast = idx === assembledDecksList.length - 1;

                      return (
                        <View
                          key={trackedDeck.deckKey}
                          style={[
                            styles.deckCard,
                            borderStyle,
                            { backgroundColor: colors.L20 },
                            !isLast ? space.marginBottomS : undefined,
                          ]}
                        >
                          <View style={styles.deckHeaderRow}>
                            <View style={styles.flex}>
                              <Text style={[typography.cardName, { color: colors.D30 }]}>
                                {trackedDeck.deck.name}
                              </Text>
                              <Text style={[typography.small, { color: colors.D10, marginTop: 2 }]}>
                                {investigator ? `${investigator.name} · ` : ''}
                                {trackedDeck.campaignName ? trackedDeck.campaignName : t`Standalone`}
                              </Text>
                              <Text style={[typography.small, { color: colors.M, marginTop: 2 }]}>
                                {t`${totalPhysicalCards} cards · Assembled: ${assembledDate}`}
                              </Text>
                            </View>
                          </View>

                          <View style={[styles.statusBadgeRow, space.marginTopS, space.marginBottomS]}>
                            {trackedDeck.hasPendingUpgrade ? (
                              <View style={[styles.statusBadge, { backgroundColor: colors.upgrade }]}>
                                <Text style={[typography.small, typography.bold, { color: '#24201C' }]}>
                                  {t`🔄 Pending Physical Upgrade`}
                                </Text>
                              </View>
                            ) : (
                              <View style={[styles.statusBadge, { backgroundColor: colors.L30 }]}>
                                <Text style={[typography.small, typography.bold, { color: colors.D30 }]}>
                                  {t`✅ Physically Assembled`}
                                </Text>
                              </View>
                            )}
                            {missingInDeck > 0 && (
                              <View style={[styles.statusBadge, { backgroundColor: colors.warn }]}>
                                <Text style={[typography.small, typography.bold, { color: '#FFFFFF' }]}>
                                  {t`⚠️ ${missingInDeck} card(s) missing (in newer deck)`}
                                </Text>
                              </View>
                            )}
                          </View>

                          {trackedDeck.hasPendingUpgrade && (
                            <DeckButton
                              icon="check-thin"
                              color="gold"
                              title={t`Update Deckbox`}
                              detail={t`Syncs physical deckbox with latest upgrades`}
                              onPress={() => handleConfirmDeckAssembly(trackedDeck)}
                              bottomMargin={xs}
                              thin
                            />
                          )}

                          <DeckButton
                            icon="deck"
                            color="default"
                            title={t`Open Checklist`}
                            onPress={() => handleOpenChecklist(trackedDeck)}
                            bottomMargin={xs}
                            thin
                          />

                          <DeckButton
                            icon="dismiss"
                            color="red_outline"
                            title={t`Disassemble (Return to Binder)`}
                            onPress={() => handleDisassembleDeck(trackedDeck.deckKey)}
                            thin
                          />
                        </View>
                      );
                    })
                  )}
                </View>
              </RoundedFactionBlock>
            </View>

            {/* Section 4: Other Decks Available to Assemble */}
            <View style={[space.paddingSideS, space.paddingBottomS]}>
              <RoundedFactionBlock
                faction="neutral"
                header={
                  <DeckSectionHeader
                    faction="neutral"
                    title={t`Other Decks Available to Assemble (${availableCount})`}
                  />
                }
              >
                <View style={space.paddingS}>
                  {mode === 'manual' && openCampaignAssemblyEntries.length > 0 && (
                    <DeckButton
                      icon="deck"
                      color="gold"
                      title={t`Assemble Open Campaigns Chronologically`}
                      detail={t`Marks uncontested cards in older campaigns and missing cards where newer campaigns took them`}
                      onPress={handlePromptChronologicalAssembly}
                      bottomMargin={s}
                      thin
                    />
                  )}
                  {availableDecksList.length === 0 ? (
                    <Text style={[typography.text, { color: colors.D10 }]}>
                      {t`No other active decks available for physical assembly.`}
                    </Text>
                  ) : (
                    map(availableDecksList, (trackedDeck, idx) => {
                      const investigator = cardsMap[trackedDeck.investigatorCode];
                      const totalTargetCards = sum(values(trackedDeck.targetSlots));
                      const deckState =
                        assembledDecksState[trackedDeck.deckKey] ||
                        assembledDecksState[trackedDeck.deckId.uuid];
                      const isIgnoredFriendDeck = deckState?.tracked === false;
                      const isLast = idx === availableDecksList.length - 1;

                      return (
                        <View
                          key={trackedDeck.deckKey}
                          style={[
                            styles.deckCard,
                            borderStyle,
                            { backgroundColor: colors.L20 },
                            !isLast ? space.marginBottomS : undefined,
                          ]}
                        >
                          <View style={styles.deckHeaderRow}>
                            <View style={styles.flex}>
                              <Text style={[typography.cardName, { color: colors.D30 }]}>
                                {trackedDeck.deck.name}
                              </Text>
                              <Text style={[typography.small, { color: colors.D10, marginTop: 2 }]}>
                                {investigator ? `${investigator.name} · ` : ''}
                                {trackedDeck.campaignName ? trackedDeck.campaignName : t`Standalone`}
                                {' · '}
                                {t`${totalTargetCards} cards`}
                              </Text>
                            </View>
                            {isIgnoredFriendDeck && (
                              <View style={[styles.ignoredBadge, { backgroundColor: colors.L10 }]}>
                                <Text style={[typography.small, { color: colors.D20 }]}>
                                  {t`Ignored (Friend)`}
                                </Text>
                              </View>
                            )}
                          </View>

                          <View style={space.marginTopS}>
                            <DeckButton
                              icon="check-thin"
                              color="default"
                              title={t`Mark as Assembled`}
                              onPress={() => handleConfirmDeckAssembly(trackedDeck)}
                              bottomMargin={xs}
                              thin
                            />

                            <TouchableOpacity
                              onPress={() => handleToggleIgnoreFriendDeck(trackedDeck, isIgnoredFriendDeck)}
                            >
                              <View
                                style={[
                                  styles.ignoreToggleRow,
                                  borderStyle,
                                  { backgroundColor: isIgnoredFriendDeck ? colors.L30 : colors.L10 },
                                ]}
                              >
                                <AppIcon
                                  name={isIgnoredFriendDeck ? 'check-thin' : 'dismiss'}
                                  size={18}
                                  color={isIgnoredFriendDeck ? colors.D30 : colors.M}
                                />
                                <Text
                                  style={[
                                    typography.small,
                                    typography.bold,
                                    space.marginLeftXs,
                                    { color: isIgnoredFriendDeck ? colors.D30 : colors.D20 },
                                  ]}
                                >
                                  {isIgnoredFriendDeck
                                    ? t`Ignored (Friend's Deck) — Tap to Track`
                                    : t`Ignore (Friend's Deck)`}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              </RoundedFactionBlock>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: s,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  modeTextColumn: {
    flex: 1,
    flexDirection: 'column',
  },
  cardConflictBox: {
    padding: s,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  conflictHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  conflictBadge: {
    paddingHorizontal: xs,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: xs,
  },
  deckCard: {
    padding: s,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  deckHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: xs,
  },
  statusBadge: {
    paddingHorizontal: s,
    paddingVertical: 4,
    borderRadius: 4,
  },
  ignoredBadge: {
    paddingHorizontal: xs,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: xs,
  },
  ignoreToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: xs,
    paddingHorizontal: s,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
