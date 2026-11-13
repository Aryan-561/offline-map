import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ChoiceOption<T extends string | number> = {
  label: string;
  value: T;
  disabled?: boolean;
};

type ChoiceChipsProps<T extends string | number> = {
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
};

export function ChoiceChips<T extends string | number>({
  options,
  value,
  onChange,
  disabled = false,
}: ChoiceChipsProps<T>) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {options.map((option) => {
        const selected = option.value === value;
        const isDisabled = disabled || option.disabled;

        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: isDisabled }}
            disabled={isDisabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
                borderColor: selected ? theme.text : 'transparent',
                opacity: isDisabled ? 0.4 : pressed ? 0.7 : 1,
              },
            ]}>
            <ThemedText
              type="small"
              themeColor={selected ? 'text' : 'textSecondary'}
              style={styles.chipText}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    borderWidth: 1,
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  chipText: {
    fontWeight: '600',
  },
});
