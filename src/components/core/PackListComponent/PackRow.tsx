import React, { useCallback, useContext } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Brackets } from 'typeorm/browser';
import { t } from 'ttag';

import { TouchableOpacity } from '@components/core/Touchables';
import { Pack } from '@actions/types';
import EncounterIcon from '@icons/EncounterIcon';
import ArkhamSwitch from '@components/core/ArkhamSwitch';
import { s, xs } from '@styles/space';
import StyleContext from '@styles/StyleContext';
import { useNavigation } from '@react-navigation/native';

interface Props {
  pack: Pack;
  packId?: string;
  cycle: Pack[];
  setChecked?: (pack_code: string, checked: boolean) => void;
  setCycleChecked?: (cycle_code: string, checked: boolean) => void;
  packQuantities?: { [pack_code: string]: number | undefined };
  setPackQuantity?: (code: string, count: number) => void;
  checked?: boolean;
  baseQuery?: Brackets;
  compact?: boolean;
  nameOverride?: string;
  description?: string;
  alwaysCycle?: boolean;
}

export default function PackRow({
  packId,
  description,
  pack,
  cycle,
  alwaysCycle,
  setChecked,
  setCycleChecked,
  packQuantities,
  setPackQuantity,
  checked,
  baseQuery,
  compact,
  nameOverride,
}: Props) {
  const { colors, fontScale, typography } = useContext(StyleContext);
  const navigation = useNavigation();
  const onPress = useCallback(() => {
    navigation.navigate('Pack', {
      pack_code: pack.code,
      pack_name: pack.name,
      baseQuery,
    });
  }, [navigation, pack, baseQuery]);

  const currentQuantity = packQuantities?.[pack.code] !== undefined ? (packQuantities[pack.code] ?? 0) : 1;

  const onDecrementQuantity = useCallback(() => {
    if (setPackQuantity) {
      setPackQuantity(pack.code, Math.max(0, currentQuantity - 1));
    }
  }, [setPackQuantity, pack.code, currentQuantity]);

  const onIncrementQuantity = useCallback(() => {
    if (setPackQuantity) {
      setPackQuantity(pack.code, currentQuantity + 1);
    }
  }, [setPackQuantity, pack.code, currentQuantity]);

  const onCheckPress = useCallback(() => {
    const value = !checked;
    if (packId) {
      if (packId === 'no_core' && setPackQuantity) {
        setPackQuantity('core', value ? 1 : 0);
        return;
      }
      setChecked && setChecked(packId, !value);
      return;
    }
    if (alwaysCycle && setCycleChecked) {
      if (cycle.length) {
        setCycleChecked(pack.code, value)
      } else {
        setChecked && setChecked(pack.code, value);
      }
      return;
    }

    setChecked && setChecked(pack.code, value);
    if (setCycleChecked &&
      pack.position === 1 &&
      pack.cycle_position > 1 &&
      pack.cycle_position < 8 &&
      cycle.length > 0
    ) {
      // This is the lead pack in a cycle.
      Alert.alert(
        value ? t`Mark entire cycle?` : t`Clear entire cycle?`,
        value ?
          t`Mark all packs in the ${pack.name} cycle?` :
          t`Clear all packs in the ${pack.name} cycle?`,
        [
          {
            text: t`No`,
          },
          { text: t`Yes`,
            onPress: () => {
              setCycleChecked(pack.code, value);
            },
          },
        ],
      );
    }
  }, [pack, cycle, checked, alwaysCycle, packId, setCycleChecked, setChecked, setPackQuantity]);

  const backgroundColor = colors.background;
  const iconSize = 24;
  const fontSize = 16 * fontScale;
  const rowHeight = compact ? 20 * fontScale * fontScale + 20 : 50;
  return (
    <View style={[styles.row,
      { backgroundColor, height: rowHeight },
      !compact ? {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: colors.divider,
      } : undefined,
    ]}>
      <View style={{ flex: 1 }}>
        <TouchableOpacity style={styles.touchable} onPress={onPress}>
          <View style={styles.touchableContent}>
            <View style={styles.icon}>
              <EncounterIcon
                encounter_code={pack.code}
                size={iconSize}
                color={colors.darkText}
                pack
              />
            </View>
            <View style={{ flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', flex: 1 }}>
              <Text
                style={[typography.large, { textAlignVertical: 'center', color: colors.darkText, fontSize }]}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                { nameOverride || pack.name }
              </Text>
              { !!description && (
                <Text
                  style={[typography.small, typography.italic, { color: colors.lightText, fontSize }]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  { description }
                </Text>
              ) }
            </View>
          </View>
        </TouchableOpacity>
      </View>
      { (!!setChecked || checked) && (
        <View style={[styles.checkbox, { height: rowHeight }]}>
          { !!setChecked && !!checked && !!setPackQuantity && (
            <View style={styles.quantityControls}>
              <TouchableOpacity
                style={[styles.qtyButton, { borderColor: colors.M, backgroundColor: colors.L20 }]}
                onPress={onDecrementQuantity}
              >
                <Text style={[typography.text, styles.qtyButtonText, { color: colors.darkText }]}>
                  -
                </Text>
              </TouchableOpacity>
              <Text style={[typography.small, styles.qtyText, { color: colors.darkText }]}>
                { `${currentQuantity}x` }
              </Text>
              <TouchableOpacity
                style={[styles.qtyButton, { borderColor: colors.M, backgroundColor: colors.L20 }]}
                onPress={onIncrementQuantity}
              >
                <Text style={[typography.text, styles.qtyButtonText, { color: colors.darkText }]}>
                  +
                </Text>
              </TouchableOpacity>
            </View>
          ) }
          <ArkhamSwitch
            value={!!checked}
            disabled={!setChecked}
            onValueChange={onCheckPress}
          />
        </View>
      ) }
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  touchable: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  touchableContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  icon: {
    marginLeft: s,
    width: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    marginRight: s,
    flexDirection: 'row',
    alignItems: 'center',
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: xs,
  },
  qtyButton: {
    width: 26,
    height: 26,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyButtonText: {
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 20,
  },
  qtyText: {
    minWidth: 26,
    textAlign: 'center',
    marginHorizontal: 4,
    fontWeight: '600',
  },
});
