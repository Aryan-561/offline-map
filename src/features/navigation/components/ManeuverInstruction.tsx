import { StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { NavigationProgress } from '../types/navigation';
import {
  formatDistance,
  formatDuration,
  maneuverLabel,
  maneuverTypeLabel,
} from '../utils/maneuverUtils';

export function ManeuverInstruction({
  progress,
}: {
  progress: NavigationProgress | null;
}) {
  const theme = useTheme();

  if (!progress) {
    return null;
  }

  const next = progress.nextManeuver;
  const roadName =
    progress.currentStreetName ?? next?.streetNames[0] ?? null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={styles.type}>{maneuverTypeLabel(next)}</Text>
        <Text style={[styles.remaining, { color: theme.textSecondary }]}>
          {formatDistance(progress.remainingDistanceMeters)} ·{' '}
          {formatDuration(progress.remainingDurationSeconds)}
        </Text>
      </View>

      <Text style={styles.distance}>
        {progress.distanceToNextManeuverMeters === null
          ? 'Continue'
          : progress.distanceToNextManeuverMeters <= 20
            ? 'Now'
            : formatDistance(progress.distanceToNextManeuverMeters)}
      </Text>
      <Text style={[styles.instruction, { color: theme.text }]}>
        {maneuverLabel(next)}
      </Text>

      {roadName && (
        <Text style={[styles.road, { color: theme.textSecondary }]}>
          {roadName}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: Spacing.three,
    elevation: 5,
    padding: Spacing.three,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  type: {
    color: '#1D72F3',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  remaining: {
    fontSize: 12,
    fontWeight: '600',
  },
  distance: {
    color: '#1D72F3',
    fontSize: 15,
    fontWeight: '700',
    marginTop: Spacing.two,
  },
  instruction: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    marginTop: 4,
  },
  road: {
    fontSize: 13,
    marginTop: 4,
  },
});
