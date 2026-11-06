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
import { filter, map, sortBy, sum, values } from 'lodash';
import { t } from 'ttag';
import { useNavigation } from '@react-navigation/native';

import {
  confirmPhysicalDeckAssembly,
  disassemblePhysicalDeck,
  setDeckPhysicalTracking,
  setPhysicalCollectionMode,
} from '@actions';
import { PhysicalCollectionMode } from '@actions/types';
import { getAssembledDecks } from '@reducers';
import {
  CardPhysicalAllocation,
  TrackedPhysicalDeck,
  usePhysicalCollectionAllocations,
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

const MODE_OPTIONS: ModeOption[] = [
  {
    value: 'manual',
    title: 'Manual por Deck/Campanha (Padrão)',
    description: 'Você escolhe quais decks estão fisicamente montados.',
  },
  {
    value: 'active_campaigns',
    title: 'Campanhas Ativas',
    description: 'Rastreia automaticamente todos os decks de campanhas não arquivadas.',
  },
  {
    value: 'all_decks',
    title: 'Todos os Decks',
    description: 'Considera todos os seus decks ativos como montados.',
  },
  {
    value: 'disabled',
    title: 'Desativado',
    description: 'Oculta avisos e badges de coleção física.',
  },
];

function formatAssembledTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime()) || date.getTime() <= 0) {
    return t`Automático`;
  }
  return date.toLocaleString('pt-BR', {
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
  const {
    mode,
    assembledDecksList,
    allTrackedDecks,
    allocationsByCanonicalCode,
    cardsMap,
    loading,
  } = usePhysicalCollectionAllocations();

  const handleSelectMode = useCallback((nextMode: PhysicalCollectionMode) => {
    dispatch(setPhysicalCollectionMode(nextMode));
  }, [dispatch]);

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

  return (
    <SafeAreaView style={[styles.container, backgroundStyle]}>
      <ScrollView
        style={[styles.list, { backgroundColor: colors.L10 }]}
        contentContainerStyle={space.paddingBottomM}
        keyboardShouldPersistTaps="always"
      >
        {/* Section 1: Modo de Rastreamento Físico */}
        <View style={[space.paddingSideS, space.paddingTopS, space.paddingBottomS]}>
          <RoundedFactionBlock
            faction="neutral"
            header={<DeckSectionHeader faction="neutral" title={t`Modo de Rastreamento Físico`} />}
          >
            <View style={[space.paddingTopXs, space.paddingBottomXs]}>
              {map(MODE_OPTIONS, (option, idx) => {
                const selected = mode === option.value;
                const isLast = idx === MODE_OPTIONS.length - 1;
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
              {t`Calculando alocações físicas...`}
            </Text>
          </View>
        )}

        {mode !== 'disabled' && (
          <>
            {/* Section 2: Resumo de Conflitos e Empréstimos Ativos */}
            <View style={[space.paddingSideS, space.paddingBottomS]}>
              <RoundedFactionBlock
                faction="neutral"
                header={
                  <DeckSectionHeader
                    faction="neutral"
                    title={t`Resumo de Conflitos e Empréstimos Ativos (${conflictAllocations.length})`}
                  />
                }
              >
                <View style={space.paddingS}>
                  {conflictAllocations.length === 0 ? (
                    <Text style={[typography.text, { color: colors.D10 }]}>
                      {t`✅ Nenhum conflito físico entre os decks montados no momento.`}
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
                                  {t`Em uso: ${alloc.totalPhysicalRequested} / Na coleção: ${alloc.totalOwned}`}
                                </Text>
                              </View>
                            </View>

                            {holdingDecks.length > 0 && (
                              <View style={space.marginTopXs}>
                                <Text style={[typography.small, typography.bold, { color: colors.D20 }]}>
                                  {t`📦 Cópia física atual com:`}
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
                                  {t`⚠️ Emprestada / Faltando em:`}
                                </Text>
                                {map(borrowingDecks, holder => (
                                  <Text
                                    key={`borrowed-${holder.deckKey}`}
                                    style={[typography.small, { color: colors.D10, marginLeft: xs }]}
                                  >
                                    {`• ${holder.deckName}${holder.campaignName ? ` (${holder.campaignName})` : ''}: faltam ${holder.borrowedCopies}x`}
                                  </Text>
                                ))}
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

            {/* Section 3: Decks Fisicamente Montados */}
            <View style={[space.paddingSideS, space.paddingBottomS]}>
              <RoundedFactionBlock
                faction="neutral"
                header={
                  <DeckSectionHeader
                    faction="neutral"
                    title={t`Decks Fisicamente Montados (${assembledDecksList.length})`}
                  />
                }
              >
                <View style={space.paddingS}>
                  {assembledDecksList.length === 0 ? (
                    <Text style={[typography.text, { color: colors.D10 }]}>
                      {t`Nenhum deck marcado como fisicamente montado.`}
                    </Text>
                  ) : (
                    map(assembledDecksList, (trackedDeck, idx) => {
                      const investigator = cardsMap[trackedDeck.investigatorCode];
                      const totalPhysicalCards = sum(values(trackedDeck.physicalSlots));
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
                                {t`${totalPhysicalCards} cartas · Montado em: ${formatAssembledTimestamp(trackedDeck.assembledAt)}`}
                              </Text>
                            </View>
                          </View>

                          <View style={[styles.statusBadgeRow, space.marginTopS, space.marginBottomS]}>
                            {trackedDeck.hasPendingUpgrade ? (
                              <View style={[styles.statusBadge, { backgroundColor: colors.upgrade }]}>
                                <Text style={[typography.small, typography.bold, { color: '#24201C' }]}>
                                  {t`🔄 Upgrade Físico Pendente`}
                                </Text>
                              </View>
                            ) : (
                              <View style={[styles.statusBadge, { backgroundColor: colors.L30 }]}>
                                <Text style={[typography.small, typography.bold, { color: colors.D30 }]}>
                                  {t`✅ Montado Fisicamente`}
                                </Text>
                              </View>
                            )}
                          </View>

                          {trackedDeck.hasPendingUpgrade && (
                            <DeckButton
                              icon="check-thin"
                              color="gold"
                              title={t`Atualizar Deckbox`}
                              detail={t`Sincroniza a deckbox física com os upgrades mais recentes`}
                              onPress={() => handleConfirmDeckAssembly(trackedDeck)}
                              bottomMargin={xs}
                              thin
                            />
                          )}

                          <DeckButton
                            icon="deck"
                            color="default"
                            title={t`Abrir Checklist`}
                            onPress={() => handleOpenChecklist(trackedDeck)}
                            bottomMargin={xs}
                            thin
                          />

                          <DeckButton
                            icon="dismiss"
                            color="red_outline"
                            title={t`Desmontar (Devolver ao Fichário)`}
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

            {/* Section 4: Outros Decks Disponíveis para Montar */}
            <View style={[space.paddingSideS, space.paddingBottomS]}>
              <RoundedFactionBlock
                faction="neutral"
                header={
                  <DeckSectionHeader
                    faction="neutral"
                    title={t`Outros Decks Disponíveis para Montar (${availableDecksList.length})`}
                  />
                }
              >
                <View style={space.paddingS}>
                  {availableDecksList.length === 0 ? (
                    <Text style={[typography.text, { color: colors.D10 }]}>
                      {t`Não há outros decks ativos disponíveis para montagem física.`}
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
                                {` · ${totalTargetCards} cartas`}
                              </Text>
                            </View>
                            {isIgnoredFriendDeck && (
                              <View style={[styles.ignoredBadge, { backgroundColor: colors.L10 }]}>
                                <Text style={[typography.small, { color: colors.D20 }]}>
                                  {t`Ignorado (Amigo)`}
                                </Text>
                              </View>
                            )}
                          </View>

                          <View style={space.marginTopS}>
                            <DeckButton
                              icon="check-thin"
                              color="default"
                              title={t`Marcar como Montado`}
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
                                    ? t`Ignorado (Deck de Amigo) — Toque para Rastrear`
                                    : t`Ignorar (Deck de Amigo)`}
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
