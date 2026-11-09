import React, { useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSelector } from 'react-redux';
import { find, forEach, sumBy } from 'lodash';
import { Brackets } from 'typeorm/browser';
import RegexEscape from 'regex-escape';

import { t } from 'ttag';

import { SORT_BY_ENCOUNTER_SET, SortType, DeckId, Slots } from '@actions/types';
import ArkhamSwitch from '@components/core/ArkhamSwitch';
import CollapsibleSearchBox from '@components/core/CollapsibleSearchBox';
import FilterBuilder, { FilterState } from '@lib/filters';
import {
  BASIC_QUERY,
  BROWSE_CARDS_QUERY,
  MYTHOS_CARDS_QUERY,
  BROWSE_CARDS_WITH_DUPLICATES_QUERY,
  NO_CUSTOM_CARDS_QUERY,
  NO_DUPLICATES_QUERY,
  where,
  combineQueries,
  combineQueriesOpt,
} from '@data/sqlite/query';
import { InvestigatorChoice, searchNormalize } from '@data/types/Card';
import { s, xs } from '@styles/space';
import ArkhamButton from '@components/core/ArkhamButton';
import StyleContext from '@styles/StyleContext';
import DbCardResultList from './DbCardResultList';
import DeckNavFooter, { PreLoadedDeckNavFooter } from '@components/deck/DeckNavFooter';
import AppIcon from '@icons/AppIcon';
import { useFilterButton } from '../hooks';
import LanguageContext from '@lib/i18n/LanguageContext';
import useDebouncedEffect from 'use-debounced-effect-hook';
import { useSettingValue } from '@components/core/hooks';
import { useParsedDeck } from '@components/deck/hooks';
import { ParsedDeckContextProvider } from '@components/deck/DeckEditContext';
import { getPhysicalCollectionMode } from '@reducers';
import { usePhysicalCollectionAllocations } from '@components/deck/usePhysicalCollectionTracker';
import SimpleFab from '@components/core/SimpleFab';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DIGIT_REGEX = /^[0-9]+$/;

interface Props {
  deckId?: DeckId;
  baseQuery?: (filters: FilterState | undefined, slots: Slots | undefined) => Brackets;
  mythosToggle?: boolean;
  showNonCollection?: boolean;
  selectedSorts?: SortType[];
  filters?: FilterState;
  mythosMode?: boolean;
  visible: boolean;
  toggleMythosMode: () => void;
  clearSearchFilters: () => void;

  investigator?: InvestigatorChoice;
  headerItems?: React.ReactNode[];
  headerHeight?: number;
  mode?: 'story' | 'side' | 'extra';

  initialSort?: SortType;
  includeDuplicates?: boolean;
  filterId: string;
}

function searchOptionsHeight(fontScale: number, showPhysicalToggle: boolean) {
  const rowCount = showPhysicalToggle ? 5 : 4;
  return 20 + (fontScale * 20 + 8) * rowCount + 12;
}

const FILTER_BUILDER = new FilterBuilder('filters');

interface SearchState {
  searchCode?: number;
  searchQuery?: RegExp;
}

function SearchOptions({
  searchText,
  searchFlavor,
  searchBack,
  showDuplicates,
  showPhysicalToggle,
  hideOccupiedPhysical,
  toggleSearchText,
  toggleSearchFlavor,
  toggleSearchBack,
  toggleShowDuplicates,
  toggleHideOccupiedPhysical,
}: {
  searchText: boolean;
  searchFlavor: boolean;
  searchBack: boolean;
  showDuplicates: boolean;
  showPhysicalToggle: boolean;
  hideOccupiedPhysical: boolean;
  toggleSearchText: () => void;
  toggleSearchFlavor: () => void;
  toggleSearchBack: () => void;
  toggleShowDuplicates: () => void;
  toggleHideOccupiedPhysical: () => void;
}) {
  const { colors, typography } = useContext(StyleContext);
  return (
    <>
      <View style={[styles.column, { alignItems: 'center', flex: 1 }]}>
        <Text style={[typography.large, { color: colors.M, fontFamily: 'Alegreya-Bold' }]}>
          { t`Search in:` }
        </Text>
      </View>
      <View style={styles.column}>
        <View style={styles.row}>
          <Text style={[typography.searchLabel, styles.searchOption, typography.dark]}>
            { t`Game Text` }
          </Text>
          <ArkhamSwitch
            value={searchText}
            onValueChange={toggleSearchText}
          />
        </View>
        <View style={styles.row}>
          <Text style={[typography.searchLabel, styles.searchOption, typography.dark]}>
            { t`Flavor Text` }
          </Text>
          <ArkhamSwitch
            value={searchFlavor}
            onValueChange={toggleSearchFlavor}
          />
        </View>
        <View style={styles.row}>
          <Text style={[typography.searchLabel, styles.searchOption, typography.dark]}>
            { t`Card Backs` }
          </Text>
          <ArkhamSwitch
            value={searchBack}
            onValueChange={toggleSearchBack}
          />
        </View>
        <View style={styles.row}>
          <Text style={[typography.searchLabel, styles.searchOption, typography.dark]}>
            { t`Show duplicate / reprint cards` }
          </Text>
          <ArkhamSwitch
            value={showDuplicates}
            onValueChange={toggleShowDuplicates}
          />
        </View>
        { showPhysicalToggle && (
          <View style={styles.row}>
            <Text style={[typography.searchLabel, styles.searchOption, typography.dark]}>
              { t`Hide cards occupied in other decks` }
            </Text>
            <ArkhamSwitch
              value={hideOccupiedPhysical}
              onValueChange={toggleHideOccupiedPhysical}
            />
          </View>
        ) }
      </View>
    </>
  );
}

function useExpandModesButtons({
  hasFilters,
  mythosToggle,
  toggleMythosMode,
  clearSearchFilters,
  mythosMode,
}: {
  hasFilters: boolean;
  mythosToggle?: boolean;
  toggleMythosMode: () => void;
  clearSearchFilters: () => void;
  mythosMode?: boolean;
}): [React.ReactNode, number] {
  if (!mythosToggle && !hasFilters) {
    return [null, 0];
  }
  return [(
    <View key="mode_buttons">
      { !!mythosToggle && (
        <ArkhamButton
          icon="search"
          onPress={toggleMythosMode}
          title={mythosMode ? t`Search player cards` : t`Search encounter cards`}
        />
      ) }
      { !!hasFilters && (
        <ArkhamButton
          icon="filter-clear"
          onPress={clearSearchFilters}
          title={t`Clear search filters`}
        />
      ) }
    </View>
  ), (mythosToggle ? 1 : 0) + (hasFilters ? 1 : 0)];
}

function useExpandSearchButtons({
  hasFilters,
  mythosToggle,
  toggleMythosMode,
  clearSearchFilters,
  mythosMode,
  searchTerm,
  searchText,
  searchBack,
  clearSearchTerm,
  toggleSearchText,
  toggleSearchBack,
}: {
  hasFilters: boolean;
  mythosToggle?: boolean;
  toggleMythosMode: () => void;
  clearSearchFilters: () => void;
  searchText: boolean;
  searchTerm?: string;
  searchBack: boolean;
  mythosMode?: boolean;
  clearSearchTerm: () => void;
  toggleSearchText: () => void;
  toggleSearchBack: () => void;
}): [React.ReactNode, number] {
  const [expandModes, expandModesCount] = useExpandModesButtons({ hasFilters, mythosToggle, toggleMythosMode, clearSearchFilters, mythosMode });
  if (!searchTerm) {
    return [expandModes, expandModesCount];
  }
  return [(
    <View key="expand_buttons">
      { !!searchTerm && (
        <ArkhamButton
          icon="search"
          onPress={clearSearchTerm}
          title={t`Clear "${searchTerm}" search`}
        />
      ) }
      { !searchText && (
        <ArkhamButton
          icon="search"
          onPress={toggleSearchText}
          title={t`Search game text`}
        />
      ) }
      { !searchBack && (
        <ArkhamButton
          icon="search"
          onPress={toggleSearchBack}
          title={t`Search card backs`}
        />
      ) }
      { expandModes }
    </View>
  ), expandModesCount + (!searchTerm ? 1 : 0) + (!searchTerm ? 1 : 0) + (!searchBack ? 1 : 0)];
}

const EMPTY_SEARCH_STATE: SearchState = {};

export default function({
  deckId,
  baseQuery,
  mythosToggle,
  showNonCollection,
  selectedSorts,
  filters,
  mythosMode,
  toggleMythosMode,
  clearSearchFilters,
  investigator,
  headerItems,
  headerHeight,
  mode,
  initialSort,
  includeDuplicates,
  filterId,
}: Props) {
  const navigation = useNavigation();
  const { fontScale, colors } = useContext(StyleContext);
  const { lang, useCardTraits } = useContext(LanguageContext);
  const [searchText, setSearchText] = useState(false);
  const [searchFlavor, setSearchFlavor] = useState(false);
  const [searchBack, setSearchBack] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(!!includeDuplicates);
  const [hideOccupiedPhysical, setHideOccupiedPhysical] = useState(false);
  const physicalMode = useSelector(getPhysicalCollectionMode);
  const showPhysicalToggle = physicalMode !== 'disabled';
  const { allocationsByCanonicalCode } = usePhysicalCollectionAllocations(
    undefined,
    showPhysicalToggle && hideOccupiedPhysical
  );
  const customContent = useSettingValue('custom_content');
  const searchEnglish = useSettingValue('search_english');
  const showCustomContent = customContent && (!deckId || deckId.local);
  const [searchTerm, setSearchTerm] = useState<string | undefined>(undefined);
  const [searchState, setSearchState] = useState<SearchState>(EMPTY_SEARCH_STATE);
  const toggleSearchText = useCallback(() => setSearchText(!searchText), [searchText]);
  const toggleSearchFlavor = useCallback(() => setSearchFlavor(!searchFlavor), [searchFlavor]);
  const toggleSearchBack = useCallback(() => setSearchBack(!searchBack), [searchBack]);
  const toggleShowDuplicates = useCallback(() => setShowDuplicates(!showDuplicates), [showDuplicates]);
  const toggleHideOccupiedPhysical = useCallback(() => setHideOccupiedPhysical(!hideOccupiedPhysical), [hideOccupiedPhysical]);

  const occupiedCanonicalCodes = useMemo(() => {
    if (!showPhysicalToggle || !hideOccupiedPhysical) {
      return [];
    }
    const result: string[] = [];
    forEach(allocationsByCanonicalCode, (allocation, canonicalCode) => {
      const heldByOthers = sumBy(
        allocation.holders,
        h => (deckId && h.deckId.uuid === deckId.uuid) ? 0 : h.heldCopies
      );
      if (heldByOthers > 0 && allocation.totalOwned - heldByOthers <= 0) {
        result.push(canonicalCode);
      }
    });
    return result;
  }, [showPhysicalToggle, hideOccupiedPhysical, allocationsByCanonicalCode, deckId]);
  useDebouncedEffect(() => {
    if (!searchTerm) {
      setSearchState(EMPTY_SEARCH_STATE);
      return;
    }
    const searchCode = DIGIT_REGEX.test(searchTerm) ? parseInt(searchTerm, 10) : undefined;
    const term = searchTerm.replace(/“|”/g, '"').replace(/‘|’/, '\'');
    setSearchState({
      searchQuery: new RegExp(`.*${RegexEscape(term)}.*`, 'i'),
      searchCode,
    });
  }, [searchTerm, setSearchState], 200);
  const clearSearchTerm = useCallback(() => setSearchTerm(''), [setSearchTerm]);

  const textQuery = useMemo(() => {
    const {
      searchCode,
    } = searchState;
    const parts: Brackets[] = [];
    if (searchCode) {
      parts.push(where(`c.position = :searchCode`, { searchCode }));
    }
    if (searchTerm === '' || !searchTerm) {
      return combineQueriesOpt(parts, 'and');
    }
    const safeSearchTerm = `%${searchNormalize(searchTerm.trim(), lang)}%`;
    const searchRealName = lang !== 'en' && searchEnglish;
    parts.push(where(
      searchRealName ?
        '(c.s_search_name like :searchTerm OR c.s_search_real_name like :searchTerm)' :
        'c.s_search_name like :searchTerm',
      { searchTerm: safeSearchTerm }
    ));
    if (searchBack) {
      parts.push(where([
        searchRealName ? 'c.s_search_name_back like :searchTerm OR c.s_search_real_name_back like :searchTerm' : 'c.s_search_name_back like :searchTerm',
        searchRealName ? '(c.linked_card is not null AND (linked_card.s_search_name like :searchTerm OR linked_card.s_search_real_name like :searchTerm))' : '(c.linked_card is not null AND linked_card.s_search_name like :searchTerm)',
        searchRealName ? '(c.linked_card is not null AND (linked_card.s_search_name_back like :searchTerm OR linked_card.s_search_real_name_back like :searchTerm))' : '(c.linked_card is not null AND linked_card.s_search_name_back like :searchTerm)',
      ].join(' OR '), { searchTerm: safeSearchTerm }
      ));
    }
    if (searchText) {
      parts.push(where('c.s_search_game like :searchTerm', { searchTerm: safeSearchTerm }));
      if (searchBack) {
        parts.push(where([
          'c.s_search_game_back like :searchTerm',
          '(c.linked_card is not null AND linked_card.s_search_game like :searchTerm)',
          '(c.linked_card is not null AND linked_card.s_search_game_back like :searchTerm)',
        ].join(' OR '), { searchTerm: safeSearchTerm }));
      }
    }
    if (searchFlavor) {
      parts.push(where('(c.s_search_flavor like :searchTerm)', { searchTerm: safeSearchTerm }));
      if (searchBack) {
        parts.push(where([
          '(c.s_search_flavor_back like :searchTerm)',
          '(c.linked_card is not null AND linked_card.s_search_flavor like :searchTerm)',
          '(c.linked_card is not null AND linked_card.s_search_flavor_back like :searchTerm)',
        ].join(' OR '), { searchTerm: safeSearchTerm }));
      }
    }
    return combineQueriesOpt(parts, 'or');
  }, [searchState, searchBack, searchFlavor, searchText, searchTerm, lang, searchEnglish]);

  const controls = (
    <SearchOptions
      searchText={searchText}
      searchFlavor={searchFlavor}
      searchBack={searchBack}
      showDuplicates={showDuplicates}
      showPhysicalToggle={showPhysicalToggle}
      hideOccupiedPhysical={hideOccupiedPhysical}
      toggleSearchText={toggleSearchText}
      toggleSearchFlavor={toggleSearchFlavor}
      toggleSearchBack={toggleSearchBack}
      toggleShowDuplicates={toggleShowDuplicates}
      toggleHideOccupiedPhysical={toggleHideOccupiedPhysical}
    />
  );

  const query = useCallback((slots: Slots | undefined) => {
    const queryParts: Brackets[] = [];
    const actuallyIncludeDuplicates = !!(includeDuplicates || showDuplicates);
    // const specialtyBuilder = new FilterBuilder("specialty");
    // return specialtyBuilder.illegalSpecialistFilter(
    //   ["#drifter#", "#homeless#"],
    //   ["survivor"]
    // );

    if (mythosToggle) {
      if (mythosMode) {
        queryParts.push(MYTHOS_CARDS_QUERY);
      } else {
        if (actuallyIncludeDuplicates) {
          queryParts.push(BROWSE_CARDS_WITH_DUPLICATES_QUERY);
        } else {
          queryParts.push(BROWSE_CARDS_QUERY);
        }
      }
    }
    if (baseQuery) {
      queryParts.push(baseQuery(filters, slots));
    }
    if (find(selectedSorts, s => s === SORT_BY_ENCOUNTER_SET)) {
      // queryParts.push(where(`c.encounter_code is not null OR linked_card.encounter_code is not null`));
    }
    if (!showCustomContent) {
      queryParts.push(NO_CUSTOM_CARDS_QUERY);
    }
    if (!actuallyIncludeDuplicates) {
      queryParts.push(NO_DUPLICATES_QUERY);
    }
    if (hideOccupiedPhysical && occupiedCanonicalCodes.length > 0) {
      const filteredOccupied = slots
        ? occupiedCanonicalCodes.filter(code => !(slots[code] && slots[code] > 0))
        : occupiedCanonicalCodes;
      if (filteredOccupied.length > 0) {
        queryParts.push(
          where(
            'c.code NOT IN (:...occupiedCodes) AND (c.duplicate_of_code IS NULL OR c.duplicate_of_code NOT IN (:...occupiedCodes)) AND (c.reprint_of_code IS NULL OR c.reprint_of_code NOT IN (:...occupiedCodes))',
            { occupiedCodes: filteredOccupied }
          )
        );
      }
    }
    return combineQueries(
      BASIC_QUERY,
      queryParts,
      'and'
    );
  }, [baseQuery, filters, mythosToggle, selectedSorts, mythosMode, includeDuplicates, showDuplicates, showCustomContent, hideOccupiedPhysical, occupiedCanonicalCodes]);
  const filterQuery = useMemo(() => filters && FILTER_BUILDER.filterToQuery(filters, useCardTraits), [filters, useCardTraits]);
  const [hasFilters, showFiltersPress] = useFilterButton({ filterId, baseQuery });
  const renderFabIcon = useMemo(() => (
    <View style={styles.relative}>
      <AppIcon name="filter" color={colors.L30} size={24} />
      { hasFilters && <View style={styles.chiclet} /> }
    </View>
  ), [colors, hasFilters]);
  const backPressed = useCallback(() => navigation.goBack(), [navigation]);
  const [expandSearchControls, expandSearchControlsHeight] = useExpandSearchButtons({
    hasFilters: !!filterQuery,
    mythosToggle,
    toggleMythosMode,
    clearSearchFilters,
    mythosMode,
    searchTerm,
    searchText,
    searchBack,
    clearSearchTerm,
    toggleSearchText,
    toggleSearchBack,
  });
  const parsedDeck = useParsedDeck(deckId);
  const insets = useSafeAreaInsets();
  return (
    <ParsedDeckContextProvider parsedDeckObj={parsedDeck}>
      <CollapsibleSearchBox
        prompt={t`Search for a card`}
        advancedOptions={{
          controls,
          height: searchOptionsHeight(fontScale, showPhysicalToggle),
        }}
        searchTerm={searchTerm || ''}
        onSearchChange={setSearchTerm}
      >
        { (handleScroll, showHeader) => (
          <>
            <DbCardResultList
              deck={parsedDeck.deckT}
              filterId={filterId}
              query={query}
              filters={filters}
              filterQuery={filterQuery || undefined}
              textQuery={textQuery}
              searchTerm={searchTerm}
              sorts={selectedSorts}
              investigator={investigator}
              handleScroll={handleScroll}
              showHeader={showHeader}
              expandSearchControls={expandSearchControls}
              expandSearchControlsHeight={expandSearchControlsHeight * ArkhamButton.computeHeight(fontScale, lang)}
              headerItems={headerItems}
              headerHeight={headerHeight}
              showNonCollection={showNonCollection}
              storyOnly={mode === 'story'}
              specialMode={(mode === 'side' || mode === 'extra') ? mode : undefined}
              mythosToggle={mythosToggle}
              initialSort={initialSort}
              footerPadding={deckId !== undefined ? DeckNavFooter.height : undefined}
            />
            { !!deckId && (
              <>
                <PreLoadedDeckNavFooter
                  parsedDeckObj={parsedDeck}
                  control="fab"
                  onPress={backPressed}
                  mode={mode === 'extra' ? 'extra' : undefined}
                />
                <SimpleFab
                  color={colors.D10}
                  icon={renderFabIcon}
                  onPress={showFiltersPress}
                  accessiblityLabel={t`Filters`}
                  position="right"
                  offsetX={s + xs}
                  offsetY={insets.bottom + s + xs}
                />
              </>
            ) }
          </>
        ) }
      </CollapsibleSearchBox>
    </ParsedDeckContextProvider>
  );
}

const styles = StyleSheet.create({
  column: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  searchOption: {
    marginLeft: s,
    marginRight: xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  relative: {
    position: 'relative',
  },
  chiclet: {
    position: 'absolute',
    top: -12,
    right: -14,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'red',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
