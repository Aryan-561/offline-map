import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { PRIMARY_COLOR } from '@/features/offline-maps/components/DownloadRegionButton';
import { useTheme } from '@/hooks/use-theme';

import { getCombinedProgress } from '../services/regionDownloadService';
import type { OfflineRegion } from '../types/offlineRegion.types';
import { formatBounds } from '../utils/calculateBounds';
import { isRegionDataReady } from '../utils/navigationReadiness';
import { DownloadProgress } from './DownloadProgress';

const STATUS_COLORS = {
  ready: '#2E7D32',
  downloading: '#3c87f7',
  paused: '#B26A00',
  failed: '#C62828',
  pending: '#60646C',
  'engine-unavailable': '#B26A00',
} as const;

type RegionDownloadCardProps = {
  region: OfflineRegion;
  isLocalEngineAvailable: boolean;
  onPause: () => Promise<unknown>;
  onResume: () => Promise<unknown>;
  onRetry: () => Promise<unknown>;
  onCancel: () => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onVerify: () => Promise<unknown>;
  onNavigateOffline: () => Promise<void> | void;
};

export function RegionDownloadCard({
  region,
  isLocalEngineAvailable,
  onPause,
  onResume,
  onRetry,
  onCancel,
  onDelete,
  onVerify,
  onNavigateOffline,
}: RegionDownloadCardProps) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const combined = getCombinedProgress(region);
  const overall = getOverallStatus(region, isLocalEngineAvailable);
  const statusColor = STATUS_COLORS[overall];
  const routingPreparing =
    region.routingStatus === 'downloading' && region.routingTotalBytes === null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete offline region?',
      `"${region.name}" and both its map and routing data will be removed from this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void run(onDelete),
        },
      ],
    );
  };

  const confirmCancel = () => {
    Alert.alert(
      'Cancel downloads?',
      'Completed data is kept. Partial routing data is removed and the map transfer is paused.',
      [
        { text: 'Keep downloading', style: 'cancel' },
        {
          text: 'Cancel downloads',
          style: 'destructive',
          onPress: () => void run(onCancel),
        },
      ],
    );
  };

  const canPause =
    region.mapStatus === 'downloading' || region.routingStatus === 'downloading';
  const canResume =
    region.mapStatus === 'paused' || region.routingStatus === 'paused';
  const canCancel =
    region.mapStatus === 'downloading' ||
    region.mapStatus === 'pending' ||
    region.mapStatus === 'paused' ||
    region.routingStatus === 'downloading' ||
    region.routingStatus === 'pending' ||
    region.routingStatus === 'paused';
  const canRetry =
    region.mapStatus === 'failed' || region.routingStatus === 'failed';
  const bothCompleted =
    region.mapStatus === 'completed' && region.routingStatus === 'completed';

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <ThemedText type="default" style={styles.name} numberOfLines={2}>
            {region.name}
          </ThemedText>
          <View style={styles.badgeRow}>
            <View style={[styles.statusPill, { backgroundColor: statusColor }]}>
              <ThemedText type="small" style={styles.statusText}>
                {overallLabel(overall)}
              </ThemedText>
            </View>
            {region.isNavigationReady && (
              <View style={[styles.statusPill, { backgroundColor: STATUS_COLORS.ready }]}>
                <ThemedText type="small" style={styles.statusText}>
                  Navigation ready
                </ThemedText>
              </View>
            )}
          </View>
        </View>
        {busy && <ActivityIndicator color={theme.text} />}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        {formatBounds(region.bounds)} · {region.radiusKm} km
      </ThemedText>

      <DownloadProgress
        label="Map data"
        status={region.mapStatus}
        progress={region.mapProgress}
        downloadedBytes={region.mapDownloadedBytes}
        totalBytes={region.mapTotalBytes}
      />

      <DownloadProgress
        label="Routing data"
        status={region.routingStatus}
        progress={region.routingProgress}
        downloadedBytes={region.routingDownloadedBytes}
        totalBytes={region.routingTotalBytes}
        preparing={routingPreparing}
      />

      {routingPreparing && (
        <ThemedText type="small" style={styles.warningText}>
          The routing-data service is building this package. Large areas can take a
          few minutes before the download starts.
        </ThemedText>
      )}

      <View style={styles.overallRow}>
        <ThemedText type="smallBold">
          Overall progress: {Math.round(combined.progress)}%
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {combined.method === 'bytes' ? 'byte-weighted' : 'estimated weights'}
        </ThemedText>
      </View>

      <View style={[styles.overallTrack, { backgroundColor: theme.backgroundSelected }]}>
        <View
          style={[
            styles.overallFill,
            { width: `${combined.progress}%`, backgroundColor: statusColor },
          ]}
        />
      </View>

      {region.mapError && (
        <ThemedText type="small" style={styles.errorText}>
          Map: {region.mapError}
        </ThemedText>
      )}

      {region.routingError && (
        <ThemedText type="small" style={styles.errorText}>
          Routing: {region.routingError}
        </ThemedText>
      )}

      {isRegionDataReady(region) && !isLocalEngineAvailable && (
        <ThemedText type="small" style={styles.warningText}>
          Routing data is installed, but this build has no local BRouter native module.
          Offline route calculation is disabled.
        </ThemedText>
      )}

      <View style={styles.actions}>
        {canPause && (
          <ActionButton label="Pause" disabled={busy} onPress={() => void run(onPause)} />
        )}
        {canResume && (
          <ActionButton
            label="Resume"
            tone="primary"
            disabled={busy}
            onPress={() => void run(onResume)}
          />
        )}
        {canRetry && (
          <ActionButton
            label="Retry failed"
            tone="primary"
            disabled={busy}
            onPress={() => void run(onRetry)}
          />
        )}
        {canCancel && (
          <ActionButton label="Cancel" disabled={busy} onPress={confirmCancel} />
        )}
        {bothCompleted && (
          <>
            <ActionButton label="Verify" disabled={busy} onPress={() => void run(onVerify)} />
            <ActionButton
              label={isLocalEngineAvailable ? 'Navigate offline' : 'Engine unavailable'}
              tone="primary"
              disabled={busy || !region.isNavigationReady || !isLocalEngineAvailable}
              onPress={() =>
                void run(async () => {
                  await onNavigateOffline();
                })
              }
            />
          </>
        )}
        <ActionButton label="Delete" tone="danger" disabled={busy} onPress={confirmDelete} />
      </View>
    </View>
  );
}

type OverallStatus =
  | 'ready'
  | 'downloading'
  | 'paused'
  | 'failed'
  | 'pending'
  | 'engine-unavailable';

function getOverallStatus(
  region: OfflineRegion,
  localEngineAvailable: boolean,
): OverallStatus {
  if (region.isNavigationReady) {
    return 'ready';
  }
  if (isRegionDataReady(region) && !localEngineAvailable) {
    return 'engine-unavailable';
  }
  if (region.mapStatus === 'failed' || region.routingStatus === 'failed') {
    return 'failed';
  }
  if (
    region.mapStatus === 'downloading' ||
    region.routingStatus === 'downloading'
  ) {
    return 'downloading';
  }
  if (region.mapStatus === 'paused' || region.routingStatus === 'paused') {
    return 'paused';
  }
  return 'pending';
}

function overallLabel(status: OverallStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'downloading':
      return 'Downloading';
    case 'paused':
      return 'Paused';
    case 'failed':
      return 'Needs attention';
    case 'engine-unavailable':
      return 'Data installed';
    default:
      return 'Queued';
  }
}

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger';
};

function ActionButton({
  label,
  onPress,
  disabled = false,
  tone = 'default',
}: ActionButtonProps) {
  const theme = useTheme();

  const color =
    tone === 'danger' ? STATUS_COLORS.failed : tone === 'primary' ? PRIMARY_COLOR : theme.text;
  const backgroundColor =
    tone === 'primary'
      ? PRIMARY_COLOR
      : tone === 'danger'
        ? theme.background
        : theme.backgroundSelected;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}>
      <ThemedText
        type="small"
        style={{ color: tone === 'primary' ? '#ffffff' : color }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  titleRow: {
    flex: 1,
    gap: Spacing.one,
    alignItems: 'flex-start',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  name: {
    fontWeight: '700',
  },
  statusPill: {
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
  },
  statusText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  overallRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  overallTrack: {
    height: 9,
    borderRadius: 5,
    overflow: 'hidden',
  },
  overallFill: {
    height: '100%',
    borderRadius: 5,
  },
  errorText: {
    color: STATUS_COLORS.failed,
  },
  warningText: {
    color: STATUS_COLORS.paused,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  actionButton: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    minHeight: 34,
    justifyContent: 'center',
  },
});
