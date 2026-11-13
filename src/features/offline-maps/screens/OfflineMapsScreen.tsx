import { router } from 'expo-router';
import * as Location from 'expo-location';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ChoiceChips } from '../components/ChoiceChips';
import { DownloadRegionButton } from '../components/DownloadRegionButton';
import { OfflineRegionCard } from '../components/OfflineRegionCard';
import { useOfflineMaps } from '../hooks/useOfflineMaps';
import {
  MAX_ESTIMATED_TILES,
  boundsCenter,
  boundsForRadius,
  defaultZoomRange,
  estimateTileCount,
  formatBounds,
  formatBytes,
  validateBounds,
} from '../services/regionService';
import {
  toOfflineMapsError,
  type OfflineBounds,
  type OfflineRegion,
} from '../types/offlineMap';

type RegionMode = 'location' | 'area' | 'coordinates';
type RadiusOption = 5 | 10 | 20;

const RADIUS_OPTIONS: RadiusOption[] = [5, 10, 20];

const MODE_OPTIONS: { label: string; value: RegionMode }[] = [
  { label: 'Around me', value: 'location' },
  { label: 'Map area', value: 'area' },
  { label: 'Coordinates', value: 'coordinates' },
];

type OfflineMapsScreenProps = {
  initialBounds?: OfflineBounds | null;
  initialName?: string;
};

export default function OfflineMapsScreen({
  initialBounds = null,
  initialName = '',
}: OfflineMapsScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {
    regions,
    storage,
    capabilities,
    styleError,
    loading,
    error,
    isSupported,
    startDownload,
    pause,
    resume,
    retry,
    remove,
    verify,
    refresh,
    clearError,
  } = useOfflineMaps();

  const [mode, setMode] = useState<RegionMode>(initialBounds ? 'area' : 'location');
  const [radius, setRadius] = useState<RadiusOption>(10);
  const [locationCenter, setLocationCenter] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [selectedBounds, setSelectedBounds] = useState<OfflineBounds | null>(initialBounds);
  const [regionName, setRegionName] = useState(initialName);
  const [zoomOverride, setZoomOverride] = useState<{
    minZoom: number;
    maxZoom: number;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [westInput, setWestInput] = useState('');
  const [southInput, setSouthInput] = useState('');
  const [eastInput, setEastInput] = useState('');
  const [northInput, setNorthInput] = useState('');

  const defaultZooms = useMemo(
    () => (capabilities ? defaultZoomRange(capabilities) : { minZoom: 0, maxZoom: 6 }),
    [capabilities],
  );
  const zoomRange = useMemo(() => {
    const range = zoomOverride ?? defaultZooms;

    if (!capabilities) {
      return range;
    }

    const minZoom = Math.min(
      capabilities.maxZoom,
      Math.max(capabilities.minZoom, range.minZoom),
    );
    const maxZoom = Math.min(
      capabilities.maxZoom,
      Math.max(capabilities.minZoom, range.maxZoom),
    );

    return { minZoom: Math.min(minZoom, maxZoom), maxZoom };
  }, [capabilities, defaultZooms, zoomOverride]);

  const { minZoom, maxZoom } = zoomRange;

  const locationBounds = useMemo(() => {
    if (!locationCenter) {
      return null;
    }

    try {
      return boundsForRadius(locationCenter.latitude, locationCenter.longitude, radius);
    } catch {
      return null;
    }
  }, [locationCenter, radius]);

  const effectiveBounds = mode === 'location' ? locationBounds : selectedBounds;

  const estimatedTiles = useMemo(() => {
    if (!effectiveBounds || !capabilities) {
      return null;
    }

    return estimateTileCount(effectiveBounds, minZoom, maxZoom);
  }, [capabilities, effectiveBounds, maxZoom, minZoom]);

  const activeRegions = regions.filter((region) => region.status !== 'completed');
  const completedRegions = regions.filter((region) => region.status === 'completed');

  const visibleError = formError ?? error;

  const clearVisibleError = () => {
    setFormError(null);
    clearError();
  };

  const handleModeChange = (nextMode: RegionMode) => {
    setFormError(null);

    if (nextMode === 'coordinates') {
      const source = effectiveBounds;
      setWestInput(source ? String(roundCoordinate(source[0])) : '');
      setSouthInput(source ? String(roundCoordinate(source[1])) : '');
      setEastInput(source ? String(roundCoordinate(source[2])) : '');
      setNorthInput(source ? String(roundCoordinate(source[3])) : '');
    }

    setMode(nextMode);
  };

  const handleUseLocation = async () => {
    setFormError(null);
    setLocationBusy(true);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setFormError(
          'Location permission was denied. Enable it in system settings to download around your position.',
        );
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLocationCenter({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      setMode('location');

      if (regionName.trim().length === 0) {
        setRegionName(`Near me · ${radius} km`);
      }
    } catch (cause) {
      setFormError(toOfflineMapsError(cause).message);
    } finally {
      setLocationBusy(false);
    }
  };

  const handleApplyCoordinates = () => {
    setFormError(null);

    try {
      const bounds = validateBounds([
        Number(westInput),
        Number(southInput),
        Number(eastInput),
        Number(northInput),
      ]);

      setSelectedBounds(bounds);
      if (regionName.trim().length === 0) {
        setRegionName('Custom area');
      }
    } catch (cause) {
      setFormError(toOfflineMapsError(cause).message);
    }
  };

  const handleDownload = async () => {
    setFormError(null);

    if (!effectiveBounds) {
      setFormError('Choose a location, map area, or coordinates first.');
      return;
    }

    if (!capabilities) {
      setFormError('Map style details are unavailable. Connect to the internet and try again.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await startDownload({
        name: regionName,
        bounds: effectiveBounds,
        minZoom,
        maxZoom,
      });

      if (result) {
        setRegionName('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleView = (region: OfflineRegion) => {
    const [longitude, latitude] = boundsCenter(region.bounds);
    router.navigate({
      pathname: '/',
      params: {
        centerLat: String(latitude),
        centerLng: String(longitude),
        zoom: String(Math.min(region.maxZoom, 14)),
      },
    });
  };

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
            <ThemedText type="subtitle">Offline maps</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Download map data now and keep using it without a connection.
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sync offline packs"
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

        {!isSupported && (
          <Notice
            title="Development build required"
            message='Offline maps use MapLibre’s native OfflineManager. Build the app with "npx expo run:android" or "npx expo run:ios", then reopen it.'
            tone="warning"
          />
        )}

        <View style={[styles.storageCard, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.storageRow}>
            <ThemedText type="small" themeColor="textSecondary">
              Downloaded map data
            </ThemedText>
            <ThemedText type="smallBold">{formatBytes(storage.downloadedBytes)}</ThemedText>
          </View>
          <View style={styles.storageRow}>
            <ThemedText type="small" themeColor="textSecondary">
              Free device storage
            </ThemedText>
            <ThemedText type="smallBold">
              {storage.availableBytes === null ? 'Unavailable' : formatBytes(storage.availableBytes)}
            </ThemedText>
          </View>
        </View>

        {visibleError && (
          <Notice
            title="Something went wrong"
            message={visibleError}
            tone="error"
            onDismiss={clearVisibleError}
          />
        )}

        {styleError && (
          <Notice
            title="Map style unavailable"
            message={`${styleError} Offline downloads are disabled until the style and its tile sources can be validated.`}
            tone="warning"
          />
        )}

        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.text} />
            <ThemedText type="small" themeColor="textSecondary">
              Recovering downloaded regions…
            </ThemedText>
          </View>
        )}

        {isSupported && (
          <View style={[styles.formCard, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="default" style={styles.sectionTitle}>
              Download a new region
            </ThemedText>

            <View style={styles.fieldGroup}>
              <ThemedText type="small" themeColor="textSecondary">
                Region name
              </ThemedText>
              <TextInput
                value={regionName}
                onChangeText={setRegionName}
                placeholder="e.g. Home area"
                placeholderTextColor={theme.textSecondary}
                maxLength={80}
                style={[
                  styles.textInput,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.backgroundSelected,
                    color: theme.text,
                  },
                ]}
              />
            </View>

            <View style={styles.fieldGroup}>
              <ThemedText type="small" themeColor="textSecondary">
                Selection method
              </ThemedText>
              <ChoiceChips options={MODE_OPTIONS} value={mode} onChange={handleModeChange} />
            </View>

            {mode === 'location' && (
              <View style={styles.fieldGroup}>
                <ThemedText type="small" themeColor="textSecondary">
                  Radius around your current location
                </ThemedText>
                <ChoiceChips
                  options={RADIUS_OPTIONS.map((value) => ({ label: `${value} km`, value }))}
                  value={radius}
                  onChange={setRadius}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={locationBusy}
                  onPress={() => void handleUseLocation()}
                  style={({ pressed }) => [
                    styles.outlineButton,
                    {
                      borderColor: theme.text,
                      opacity: locationBusy ? 0.5 : pressed ? 0.7 : 1,
                    },
                  ]}>
                  {locationBusy ? (
                    <ActivityIndicator color={theme.text} />
                  ) : (
                    <ThemedText type="smallBold">
                      {locationCenter ? 'Refresh current location' : 'Use current location'}
                    </ThemedText>
                  )}
                </Pressable>
                {locationCenter ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Using {locationCenter.latitude.toFixed(5)}, {locationCenter.longitude.toFixed(5)}
                  </ThemedText>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    Location permission is needed to calculate this region.
                  </ThemedText>
                )}
              </View>
            )}

            {mode === 'area' && (
              <View style={styles.fieldGroup}>
                <ThemedText type="small" themeColor="textSecondary">
                  Download the current map viewport
                </ThemedText>
                {selectedBounds ? (
                  <ThemedText type="small">{formatBounds(selectedBounds)}</ThemedText>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    No map area selected yet.
                  </ThemedText>
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.navigate('/')}
                  style={({ pressed }) => [
                    styles.outlineButton,
                    { borderColor: theme.text, opacity: pressed ? 0.7 : 1 },
                  ]}>
                  <ThemedText type="smallBold">Choose area on map</ThemedText>
                </Pressable>
                <ThemedText type="small" themeColor="textSecondary">
                  On the map, pan and zoom to the area, then tap “Download area”.
                </ThemedText>
              </View>
            )}

            {mode === 'coordinates' && (
              <View style={styles.fieldGroup}>
                <ThemedText type="small" themeColor="textSecondary">
                  Southwest and northeast corners
                </ThemedText>
                <View style={styles.coordinateRow}>
                  <CoordinateInput
                    label="West"
                    value={westInput}
                    onChangeText={setWestInput}
                  />
                  <CoordinateInput
                    label="South"
                    value={southInput}
                    onChangeText={setSouthInput}
                  />
                </View>
                <View style={styles.coordinateRow}>
                  <CoordinateInput
                    label="East"
                    value={eastInput}
                    onChangeText={setEastInput}
                  />
                  <CoordinateInput
                    label="North"
                    value={northInput}
                    onChangeText={setNorthInput}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleApplyCoordinates}
                  style={({ pressed }) => [
                    styles.outlineButton,
                    { borderColor: theme.text, opacity: pressed ? 0.7 : 1 },
                  ]}>
                  <ThemedText type="smallBold">Use these coordinates</ThemedText>
                </Pressable>
              </View>
            )}

            <View style={styles.zoomRow}>
              <ZoomStepper
                label="Minimum zoom"
                value={minZoom}
                min={capabilities?.minZoom ?? 0}
                max={maxZoom}
                disabled={!capabilities}
                onChange={(value) =>
                  setZoomOverride({ minZoom: Math.min(value, maxZoom), maxZoom })
                }
              />
              <ZoomStepper
                label="Maximum zoom"
                value={maxZoom}
                min={minZoom}
                max={capabilities?.maxZoom ?? 22}
                disabled={!capabilities}
                onChange={(value) =>
                  setZoomOverride({ minZoom, maxZoom: Math.max(value, minZoom) })
                }
              />
            </View>

            <ThemedText type="small" themeColor="textSecondary">
              {capabilities
                ? `This map style supports zoom ${capabilities.minZoom}–${capabilities.maxZoom}.${
                    estimatedTiles !== null ? ` Estimated tiles: ~${estimatedTiles.toLocaleString()}.` : ''
                  }`
                : 'Loading map style limits…'}
            </ThemedText>

            {estimatedTiles !== null && estimatedTiles > MAX_ESTIMATED_TILES && (
              <ThemedText type="small" style={styles.errorText}>
                This selection is too large. Reduce the radius or the maximum zoom.
              </ThemedText>
            )}

            <DownloadRegionButton
              label="Download region"
              onPress={() => void handleDownload()}
              disabled={
                !effectiveBounds ||
                !capabilities ||
                Boolean(styleError) ||
                (estimatedTiles !== null && estimatedTiles > MAX_ESTIMATED_TILES)
              }
              loading={submitting}
            />
          </View>
        )}

        <View style={styles.section}>
          <ThemedText type="default" style={styles.sectionTitle}>
            Downloads
          </ThemedText>
          {activeRegions.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No active, paused, or failed downloads.
            </ThemedText>
          ) : (
            activeRegions.map((region) => (
              <OfflineRegionCard
                key={region.id}
                region={region}
                onPause={() => pause(region.id)}
                onResume={() => resume(region.id)}
                onRetry={() => retry(region.id)}
                onDelete={() => remove(region.id)}
                onVerify={() => verify(region.id)}
              />
            ))
          )}
        </View>

        <View style={styles.section}>
          <ThemedText type="default" style={styles.sectionTitle}>
            Downloaded regions
          </ThemedText>
          {completedRegions.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Downloaded regions will appear here and remain available after restarting the app.
            </ThemedText>
          ) : (
            completedRegions.map((region) => (
              <OfflineRegionCard
                key={region.id}
                region={region}
                onPause={() => pause(region.id)}
                onResume={() => resume(region.id)}
                onRetry={() => retry(region.id)}
                onDelete={() => remove(region.id)}
                onVerify={() => verify(region.id)}
                onView={() => handleView(region)}
              />
            ))
          )}
        </View>

        <ThemedText type="small" themeColor="textSecondary" style={styles.footerNote}>
          To verify offline data: download a small region, wait for “Downloaded”, restart the app,
          enable airplane mode, then open the region with View. Tiles, labels, fonts and sprites
          must render without a connection.
        </ThemedText>
      </View>
    </ScrollView>
  );
}

type NoticeProps = {
  title: string;
  message: string;
  tone: 'warning' | 'error';
  onDismiss?: () => void;
};

function Notice({ title, message, tone, onDismiss }: NoticeProps) {
  const theme = useTheme();
  const color = tone === 'error' ? '#C62828' : '#B26A00';

  return (
    <View style={[styles.notice, { backgroundColor: theme.backgroundElement, borderColor: color }]}>
      <View style={styles.noticeText}>
        <ThemedText type="smallBold" style={{ color }}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {message}
        </ThemedText>
      </View>
      {onDismiss && (
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss}>
          <ThemedText type="smallBold">Dismiss</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

type CoordinateInputProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
};

function CoordinateInput({ label, value, onChangeText }: CoordinateInputProps) {
  const theme = useTheme();

  return (
    <View style={styles.coordinateInput}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="-180"
        placeholderTextColor={theme.textSecondary}
        keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.textInput,
          {
            backgroundColor: theme.background,
            borderColor: theme.backgroundSelected,
            color: theme.text,
          },
        ]}
      />
    </View>
  );
}

type ZoomStepperProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
};

function ZoomStepper({ label, value, min, max, disabled = false, onChange }: ZoomStepperProps) {
  const theme = useTheme();

  return (
    <View style={styles.zoomStepper}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.stepperRow}>
        <StepButton
          label="−"
          accessibilityLabel={`Decrease ${label}`}
          disabled={disabled || value <= min}
          onPress={() => onChange(value - 1)}
        />
        <ThemedText type="smallBold" style={styles.stepperValue}>
          {value}
        </ThemedText>
        <StepButton
          label="+"
          accessibilityLabel={`Increase ${label}`}
          disabled={disabled || value >= max}
          onPress={() => onChange(value + 1)}
        />
      </View>
      <View style={styles.stepperTrack}>
        <View
          style={[
            styles.stepperFill,
            {
              backgroundColor: theme.text,
              width: `${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

type StepButtonProps = {
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
};

function StepButton({ label, accessibilityLabel, disabled, onPress }: StepButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stepButton,
        {
          backgroundColor: theme.background,
          borderColor: theme.backgroundSelected,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}>
      <ThemedText type="smallBold" style={styles.stepLabel}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1e6) / 1e6;
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
  sectionTitle: {
    fontWeight: '700',
    fontSize: 18,
  },
  fieldGroup: {
    gap: Spacing.two,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    minHeight: 44,
  },
  outlineButton: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  coordinateRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  coordinateInput: {
    flex: 1,
    gap: Spacing.one,
  },
  zoomRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  zoomStepper: {
    flex: 1,
    gap: Spacing.one,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  stepperValue: {
    minWidth: 24,
    textAlign: 'center',
  },
  stepperTrack: {
    height: 2,
    backgroundColor: 'transparent',
  },
  stepperFill: {
    height: 2,
    opacity: 0.3,
  },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: {
    fontSize: 18,
    lineHeight: 20,
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
  errorText: {
    color: '#C62828',
  },
  section: {
    gap: Spacing.two,
  },
  footerNote: {
    paddingBottom: Spacing.four,
  },
});
