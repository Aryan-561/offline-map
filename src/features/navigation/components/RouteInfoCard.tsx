import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Coordinate, RouteResult, TravelMode } from '../types/navigation';
import {
  formatCoordinate,
  formatDistance,
  formatDuration,
} from '../utils/maneuverUtils';
import { RouteModeSelector } from './RouteModeSelector';

type RouteInfoCardProps = {
  destination: Coordinate;
  destinationLabel?: string | null;
  route: RouteResult | null;
  mode: TravelMode;
  isCalculating: boolean;
  onModeChange: (mode: TravelMode) => void;
  onCalculate: () => void;
  onStart: () => void;
  onCancel: () => void;
};

export function RouteInfoCard({
  destination,
  destinationLabel = null,
  route,
  mode,
  isCalculating,
  onModeChange,
  onCalculate,
  onStart,
  onCancel,
}: RouteInfoCardProps) {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <RouteModeSelector mode={mode} onChange={onModeChange} />

      <View style={styles.destinationRow}>
        <View style={styles.destinationText}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>
            Destination
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.destination, { color: theme.text }]}>
            {destinationLabel ??
              formatCoordinate(destination.latitude, destination.longitude)}
          </Text>
          {destinationLabel && (
            <Text style={[styles.destinationHint, { color: theme.textSecondary }]}>
              {formatCoordinate(destination.latitude, destination.longitude)}
            </Text>
          )}
        </View>
        <Pressable accessibilityRole="button" onPress={onCancel}>
          <Text style={styles.clear}>Clear</Text>
        </Pressable>
      </View>

      {route ? (
        <View style={[styles.summary, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.summaryText, { color: theme.text }]}>
            {formatDistance(route.distanceMeters)} ·{' '}
            {formatDuration(route.durationSeconds)}
          </Text>
          <Text style={[styles.summaryMode, { color: theme.textSecondary }]}>
            {mode === 'auto' ? 'Driving' : 'Walking'} route ready
          </Text>
        </View>
      ) : (
        <Text style={[styles.placeholder, { color: theme.textSecondary }]}>
          {isCalculating
            ? 'Calculating the best route…'
            : 'No route calculated yet.'}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={isCalculating || !route}
        onPress={onStart}
        style={({ pressed }) => [
          styles.action,
          {
            backgroundColor: '#1D72F3',
            opacity: isCalculating || !route ? 0.5 : pressed ? 0.8 : 1,
          },
        ]}>
        <Text style={styles.actionText}>
          {isCalculating ? 'Calculating…' : 'Start navigation'}
        </Text>
      </Pressable>

      <View style={styles.secondaryRow}>
        <Pressable
          accessibilityRole="button"
          disabled={isCalculating}
          onPress={onCalculate}
          style={({ pressed }) => [
            styles.secondaryButton,
            {
              backgroundColor: theme.backgroundElement,
              opacity: isCalculating ? 0.5 : pressed ? 0.7 : 1,
            },
          ]}>
          <Text style={[styles.secondaryText, { color: theme.text }]}>
            {route ? 'Recalculate' : 'Calculate route'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: Spacing.three,
    elevation: 5,
    gap: Spacing.two,
    padding: Spacing.three,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  destinationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  destinationText: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  destination: {
    fontSize: 14,
    fontWeight: '600',
  },
  destinationHint: {
    fontSize: 11,
  },
  clear: {
    color: '#D93025',
    fontSize: 14,
    fontWeight: '700',
  },
  summary: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  summaryText: {
    fontSize: 18,
    fontWeight: '700',
  },
  summaryMode: {
    fontSize: 12,
    marginTop: 2,
  },
  placeholder: {
    fontSize: 13,
  },
  action: {
    alignItems: 'center',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryRow: {
    flexDirection: 'row',
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: Spacing.two,
    flex: 1,
    paddingVertical: Spacing.two,
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
