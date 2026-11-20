import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function NavigationHeader() {
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to the map"
        onPress={() => router.navigate('/')}>
        <Text style={[styles.back, { color: colors.text }]}>Map</Text>
      </Pressable>
      <Text style={[styles.title, { color: colors.text }]}>Navigation</Text>
      <View style={styles.placeholder} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  back: { fontSize: 16 },
  title: { fontSize: 18, fontWeight: '700' },
  placeholder: { width: 40 },
});
