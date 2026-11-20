import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type NavigationControlsProps = {
  onStop: () => void;
  onEnd: () => void;
};

export function NavigationControls({ onStop, onEnd }: NavigationControlsProps) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop navigation and keep the route"
        onPress={onStop}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: theme.background, opacity: pressed ? 0.7 : 1 },
        ]}>
        <Text style={[styles.buttonText, { color: theme.text }]}>
          Stop navigation
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="End route and clear destination"
        onPress={onEnd}
        style={({ pressed }) => [
          styles.button,
          styles.endButton,
          { opacity: pressed ? 0.7 : 1 },
        ]}>
        <Text style={[styles.buttonText, styles.endButtonText]}>End route</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  button: {
    borderRadius: 20,
    elevation: 4,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  endButton: {
    backgroundColor: '#D93025',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  endButtonText: {
    color: '#FFFFFF',
  },
});
