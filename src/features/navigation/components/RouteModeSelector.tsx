import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { TravelMode } from '../types/navigation';

type RouteModeSelectorProps = {
  mode: TravelMode;
  onChange: (mode: TravelMode) => void;
};

export function RouteModeSelector({ mode, onChange }: RouteModeSelectorProps) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      {(['auto', 'pedestrian'] as TravelMode[]).map((value) => {
        const selected = mode === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(value)}
            style={[
              styles.option,
              {
                backgroundColor: selected
                  ? '#1D72F3'
                  : theme.backgroundElement,
              },
            ]}>
            <Text
              style={[
                styles.label,
                { color: selected ? '#FFFFFF' : theme.text },
              ]}>
              {value === 'auto' ? 'Driving' : 'Walking'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', gap: Spacing.two },
  option: {
    borderRadius: 20,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  label: { fontSize: 14, fontWeight: '700' },
});
