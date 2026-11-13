import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export const PRIMARY_COLOR = '#3c87f7';

type DownloadRegionButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export function DownloadRegionButton({
  label,
  onPress,
  disabled = false,
  loading = false,
}: DownloadRegionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { opacity: disabled || loading ? 0.5 : pressed ? 0.8 : 1 },
      ]}>
      {loading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <ThemedText type="smallBold" style={styles.label}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: Spacing.three,
    backgroundColor: PRIMARY_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  label: {
    color: '#ffffff',
    fontSize: 16,
  },
});
