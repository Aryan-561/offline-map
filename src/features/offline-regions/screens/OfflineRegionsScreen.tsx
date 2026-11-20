import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBytes } from '@/features/offline-maps/services/regionService';
import { activateOfflineRouting } from '@/features/navigation/services/localValhallaAdapter';
import { useTheme } from '@/hooks/use-theme';

import { OfflineRegionList } from '../components/OfflineRegionList';
import { RegionSelector } from '../components/RegionSelector';
import { useOfflineRegions } from '../hooks/useOfflineRegions';
import { useRegionDownload } from '../hooks/useRegionDownload';
import {
  toOfflineRegionsError,
  type OfflineRegion,
  type OfflineRegionBounds,
} from '../types/offlineRegion.types';
import { isRegionDataReady } from '../utils/navigationReadiness';

type OfflineRegionsScreenProps = {
  initialBounds?: OfflineRegionBounds | null;
  initialName?: string;
};

export default function OfflineRegionsScreen({
  initialBounds = null,
  initialName = '',
}: OfflineRegionsScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const list = useOfflineRegions();
  const draft = useRegionDownload({
    bounds: initialBounds,
    name: initialName,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);

  const activeRegions = list.regions.filter(
    (region) => !region.isNavigationReady && !isRegionDataReady(region),
  );
  const engineWaitingRegions = list.regions.filter(
    (region) => !region.isNavigationReady && isRegionDataReady(region),
  );
  const readyRegions = list.regions.filter((region) => region.isNavigationReady);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await list.refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleNavigateOffline = async (region: OfflineRegion) => {
    setNavigationError(null);

    try {
      await activateOfflineRouting(region.id);
      router.push('/navigate');
    } catch (cause) {
      setNavigationError(toOfflineRegionsError(cause).message);
    }
  };

  const visibleError = navigationError ?? list.error ?? draft.error;

  const contentPlatformStyle = Platform.select({
    android: {
      paddingTop: insets.top,
      paddingLeft: insets.left,
      paddingRight: insets.right,
      paddingBottom: insets.bottom + BottomTabInset,
    },
    default: {
      paddingTop: insets.top,
      paddingBottom: insets.bottom + BottomTabInset + Spacing.three,
      paddingLeft: insets.left,
      paddingRight: insets.right,
    },
  });

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.contentContainer, contentPlatformStyle]}
      keyboardShouldPersistTaps="handled">
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <ThemedText type="subtitle">Offline regions</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Download map rendering data and Valhalla routing data together so a
              region can work without a connection.
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh offline regions"
            disabled={refreshing}
            onPress={() => void handleRefresh()}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                backgroundColor: theme.backgroundElement,
                opacity: refreshing ? 0.5 : pressed ? 0.7 : 1,
              },
            ]}>
            {refreshing ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <ThemedText type="smallBold">Sync</ThemedText>
            )}
          </Pressable>
        </View>

        {!list.isSupported && (
          <Notice
            title="Development build required"
            message='Offline map packs use MapLibre’s native OfflineManager. Build with "npx expo run:android" or "npx expo run:ios", then reopen the app.'
            tone="warning"
          />
        )}

        {!list.isRoutingConfigured && (
          <Notice
            title="Routing data service not configured"
            message="Map downloads still work, but routing packages need EXPO_PUBLIC_ROUTING_DATA_BASE_URL. See tools/routing-data/README.md for the backend contract."
            tone="warning"
          />
        )}

        {!list.isLocalEngineAvailable && (
          <Notice
            title="Local Valhalla engine not bundled"
            message="Routing data can be downloaded and verified, but this build or platform has no registered native Valhalla engine. Use a development build that includes the Valhalla module; offline route calculation stays disabled here."
            tone="warning"
          />
        )}

        <View style={[styles.storageCard, { backgroundColor: theme.backgroundElement }]}>
          <StorageRow
            label="Downloaded offline data"
            value={formatBytes(list.storage.downloadedBytes)}
          />
          <StorageRow
            label="Free device storage"
            value={
              list.storage.availableBytes === null
                ? 'Unavailable'
                : formatBytes(list.storage.availableBytes)
            }
          />
        </View>

        {visibleError && (
          <Notice
            title="Something went wrong"
            message={visibleError}
            tone="error"
            onDismiss={() => {
              setNavigationError(null);
              list.clearError();
              draft.clearError();
            }}
          />
        )}

        {list.loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.text} />
            <ThemedText type="small" themeColor="textSecondary">
              Recovering offline regions…
            </ThemedText>
          </View>
        )}

        {list.isSupported && (
          <View style={[styles.formCard, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="default" style={styles.sectionTitle}>
              Download a new region
            </ThemedText>
            <RegionSelector
              center={draft.center}
              name={draft.name}
              onNameChange={draft.setName}
              radiusKm={draft.radiusKm}
              onRadiusChange={draft.setRadiusKm}
              bounds={draft.bounds}
              preview={draft.preview}
              estimatedTiles={draft.estimatedTiles}
              mapEstimateBytes={draft.mapEstimateBytes}
              routingEstimateBytes={draft.routingEstimateBytes}
              routingWillBuild={draft.routingWillBuild}
              totalEstimateBytes={draft.totalEstimateBytes}
              estimatingRouting={draft.estimatingRouting}
              routingEstimateError={draft.routingEstimateError}
              onRetryRoutingEstimate={draft.refreshRoutingEstimate}
              styleError={draft.styleError}
              loadingLocation={draft.loadingLocation}
              starting={draft.starting}
              error={draft.error}
              onLocate={() => void draft.locate()}
              onStart={() => void draft.start()}
              onClearError={draft.clearError}
            />
          </View>
        )}

        <View style={styles.section}>
          <ThemedText type="default" style={styles.sectionTitle}>
            In progress and incomplete
          </ThemedText>
          {activeRegions.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No queued, paused, failed, or partially downloaded regions.
            </ThemedText>
          ) : (
            <OfflineRegionList
              regions={activeRegions}
              isLocalEngineAvailable={list.isLocalEngineAvailable}
              onPause={list.pause}
              onResume={list.resume}
              onRetry={list.retry}
              onCancel={list.cancel}
              onDelete={list.remove}
              onVerify={list.verify}
              onNavigateOffline={handleNavigateOffline}
            />
          )}
        </View>

        {engineWaitingRegions.length > 0 && (
          <View style={styles.section}>
            <ThemedText type="default" style={styles.sectionTitle}>
              Downloaded data, engine unavailable
            </ThemedText>
            <OfflineRegionList
              regions={engineWaitingRegions}
              isLocalEngineAvailable={list.isLocalEngineAvailable}
              onPause={list.pause}
              onResume={list.resume}
              onRetry={list.retry}
              onCancel={list.cancel}
              onDelete={list.remove}
              onVerify={list.verify}
              onNavigateOffline={handleNavigateOffline}
            />
          </View>
        )}

        <View style={styles.section}>
          <ThemedText type="default" style={styles.sectionTitle}>
            Offline-navigation-ready regions
          </ThemedText>
          {readyRegions.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              A region appears here only after both the map pack and the routing
              package are installed, checksum-verified, and marked navigation-ready.
            </ThemedText>
          ) : (
            <OfflineRegionList
              regions={readyRegions}
              isLocalEngineAvailable={list.isLocalEngineAvailable}
              onPause={list.pause}
              onResume={list.resume}
              onRetry={list.retry}
              onCancel={list.cancel}
              onDelete={list.remove}
              onVerify={list.verify}
              onNavigateOffline={handleNavigateOffline}
            />
          )}
        </View>

        <ThemedText type="small" themeColor="textSecondary" style={styles.footerNote}>
          A region is marked navigation-ready only when both datasets are
          installed and checksum-verified and a native Valhalla engine is
          registered. Verify on a physical device in airplane mode before relying
          on it.
        </ThemedText>
      </View>
    </ScrollView>
  );
}

function StorageRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.storageRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

function Notice({
  title,
  message,
  tone,
  onDismiss,
}: {
  title: string;
  message: string;
  tone: 'warning' | 'error';
  onDismiss?: () => void;
}) {
  const theme = useTheme();
  const color = tone === 'error' ? '#C62828' : '#B26A00';

  return (
    <View
      style={[
        styles.notice,
        { backgroundColor: theme.backgroundElement, borderColor: color },
      ]}>
      <View style={styles.noticeText}>
        <ThemedText type="smallBold" style={{ color }}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {message}
        </ThemedText>
      </View>
      {onDismiss && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={onDismiss}>
          <ThemedText type="smallBold">Dismiss</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  content: {
    maxWidth: MaxContentWidth,
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.four,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  headerText: {
    flex: 1,
    gap: Spacing.one,
  },
  secondaryButton: {
    minHeight: 38,
    minWidth: 64,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  storageCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  storageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  formCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  section: {
    gap: Spacing.two,
  },
  sectionTitle: {
    fontWeight: '700',
    fontSize: 18,
  },
  notice: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  noticeText: {
    flex: 1,
    gap: Spacing.one,
  },
  footerNote: {
    paddingBottom: Spacing.four,
  },
});
