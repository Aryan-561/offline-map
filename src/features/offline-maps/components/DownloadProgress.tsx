import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { formatBytes } from '../services/regionService';
import type { OfflineRegion, OfflineRegionStatus } from '../types/offlineMap';

const STATUS_COLORS: Record<OfflineRegionStatus, string> = {
  pending: '#60646C',
  downloading: '#3c87f7',
  paused: '#B26A00',
  completed: '#2E7D32',
  failed: '#C62828',
  missing: '#C62828',
};

type DownloadProgressProps = {
  region: OfflineRegion;
};

export function DownloadProgress({ region }: DownloadProgressProps) {
  const theme = useTheme();
  const progress = Math.min(100, Math.max(0, region.progress));
  const color = STATUS_COLORS[region.status];

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText type="small" themeColor="textSecondary">
          {Math.round(progress)}%
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {region.requiredResourceCount > 0
            ? `${region.completedResourceCount.toLocaleString()} / ${region.requiredResourceCount.toLocaleString()} resources`
            : formatBytes(region.sizeBytes)}
        </ThemedText>
      </View>

      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        <View style={[styles.fill, { backgroundColor: color, width: `${progress}%` }]} />
      </View>

      {region.sizeBytes > 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          {formatBytes(region.sizeBytes)} on device
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
});
