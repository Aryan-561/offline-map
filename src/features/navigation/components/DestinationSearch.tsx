import { useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { searchDestinations } from '../services/searchService';
import type { Coordinate, PlaceResult } from '../types/navigation';
import { formatCoordinate, formatDistance } from '../utils/maneuverUtils';

type DestinationSearchProps = {
  destination: Coordinate | null;
  near?: Coordinate | null;
  onSelect: (coordinate: Coordinate) => void;
  onClear: () => void;
};

export function DestinationSearch({
  destination,
  near = null,
  onSelect,
  onClear,
}: DestinationSearchProps) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return;
    }

    setIsSearching(true);
    setError(null);
    setResults([]);

    try {
      const found = await searchDestinations(trimmed, {
        limit: 5,
        near,
      });
      if (found.length === 0) {
        setError(
          'No place found. Try another name, or enter coordinates as "latitude, longitude".',
        );
      } else {
        setResults(found);
      }
    } catch {
      setError(
        'Place search needs an internet connection. Turn it on, enter coordinates, or tap the map.',
      );
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelect = (result: PlaceResult) => {
    Keyboard.dismiss();
    setResults([]);
    setQuery('');
    setError(null);
    onSelect(result.coordinate);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.searchRow}>
        <TextInput
          accessibilityLabel="Search for a destination"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void handleSearch()}
          placeholder="Search a place by name or lat, lng"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={[
            styles.input,
            {
              backgroundColor: theme.backgroundElement,
              color: theme.text,
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search destinations"
          disabled={isSearching}
          onPress={() => void handleSearch()}
          style={({ pressed }) => [
            styles.searchButton,
            { backgroundColor: '#1D72F3', opacity: isSearching || pressed ? 0.7 : 1 },
          ]}>
          {isSearching ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.searchButtonText}>Search</Text>
          )}
        </Pressable>
      </View>

      {error && (
        <Text style={[styles.error, { color: theme.textSecondary }]}>{error}</Text>
      )}

      {results.length > 0 && (
        <View style={styles.results}>
          {results.map((result) => (
            <Pressable
              key={result.id}
              accessibilityRole="button"
              onPress={() => handleSelect(result)}
              style={({ pressed }) => [
                styles.resultRow,
                {
                  backgroundColor: pressed
                    ? theme.backgroundSelected
                    : theme.backgroundElement,
                },
              ]}>
              <Text style={[styles.resultLabel, { color: theme.text }]}>
                {result.label}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.resultHint, { color: theme.textSecondary }]}>
                {result.description ? `${result.description} · ` : ''}
                {result.distanceMeters != null
                  ? formatDistance(result.distanceMeters)
                  : 'Use this destination'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {destination ? (
        <View style={styles.row}>
          <View style={styles.destinationText}>
            <Text style={[styles.title, { color: theme.text }]}>
              Destination selected
            </Text>
            <Text style={[styles.coordinates, { color: theme.textSecondary }]}>
              {formatCoordinate(destination.latitude, destination.longitude)}
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={onClear}>
            <Text style={styles.clear}>Change</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.hint, { color: theme.textSecondary }]}>
          Tap the map to drop a pin, or search for a place by name.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: Spacing.three,
    elevation: 4,
    gap: Spacing.two,
    padding: Spacing.three,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  searchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
  },
  input: {
    borderRadius: Spacing.two,
    flex: 1,
    fontSize: 15,
    minHeight: 42,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  searchButton: {
    alignItems: 'center',
    borderRadius: Spacing.two,
    justifyContent: 'center',
    minHeight: 42,
    minWidth: 76,
    paddingHorizontal: Spacing.three,
  },
  searchButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  error: {
    fontSize: 12,
    lineHeight: 16,
  },
  results: {
    gap: Spacing.one,
  },
  resultRow: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  resultLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  resultHint: {
    fontSize: 12,
    marginTop: 2,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  destinationText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  coordinates: {
    fontSize: 13,
  },
  clear: {
    color: '#1D72F3',
    fontSize: 14,
    fontWeight: '700',
  },
  hint: {
    fontSize: 12,
    lineHeight: 16,
  },
});
