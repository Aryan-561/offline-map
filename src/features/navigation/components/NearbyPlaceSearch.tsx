import { useCallback, useEffect, useRef, useState } from 'react';
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
import { formatDistance } from '../utils/maneuverUtils';

const SEARCH_DEBOUNCE_MS = 450;
const MIN_QUERY_LENGTH = 2;

type NearbyPlaceSearchProps = {
  near: Coordinate | null;
  onSelect: (place: PlaceResult) => void;
  placeholder?: string;
};

export function NearbyPlaceSearch({
  near,
  onSelect,
  placeholder = 'Search nearby places by name',
}: NearbyPlaceSearchProps) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const requestId = useRef(0);
  const nearRef = useRef(near);
  const suppressedQuery = useRef<string | null>(null);

  useEffect(() => {
    nearRef.current = near;
  }, [near]);

  const runSearch = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const id = requestId.current + 1;
      requestId.current = id;

      if (trimmed.length < MIN_QUERY_LENGTH) {
        setResults([]);
        setError(null);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      setError(null);

      try {
        const found = await searchDestinations(trimmed, {
          limit: 8,
          near: nearRef.current,
        });
        if (requestId.current !== id) {
          return;
        }
        setResults(found);
        if (found.length === 0) {
          setError(
            'No place found. Try a different name or enter coordinates as "lat, lng".',
          );
        }
      } catch {
        if (requestId.current !== id) {
          return;
        }
        setResults([]);
        setError(
          nearRef.current
            ? 'Place search needs an internet connection. Check your connection and try again.'
            : 'Place search needs an internet connection.',
        );
      } finally {
        if (requestId.current === id) {
          setIsSearching(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      return;
    }

    if (trimmed === suppressedQuery.current) {
      return;
    }

    const timer = setTimeout(() => {
      void runSearch(trimmed);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const handleChangeText = (text: string) => {
    suppressedQuery.current = null;
    setQuery(text);

    if (text.trim().length < MIN_QUERY_LENGTH) {
      requestId.current += 1;
      setResults([]);
      setError(null);
      setIsSearching(false);
    }
  };

  const handleSelect = (place: PlaceResult) => {
    Keyboard.dismiss();
    requestId.current += 1;
    suppressedQuery.current = place.label;
    setQuery(place.label);
    setResults([]);
    setError(null);
    setIsSearching(false);
    onSelect(place);
  };

  const handleClear = () => {
    requestId.current += 1;
    suppressedQuery.current = null;
    setQuery('');
    setResults([]);
    setError(null);
    setIsSearching(false);
  };

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.searchRow,
          {
            backgroundColor: theme.background,
            shadowColor: '#000000',
          },
        ]}>
        <TextInput
          accessibilityLabel="Search nearby places by name"
          value={query}
          onChangeText={handleChangeText}
          onSubmitEditing={() => void runSearch(query)}
          placeholder={placeholder}
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
        {query.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={handleClear}
            style={styles.clearButton}>
            <Text style={[styles.clearText, { color: theme.textSecondary }]}>✕</Text>
          </Pressable>
        )}
        {isSearching && (
          <ActivityIndicator color={theme.textSecondary} style={styles.spinner} />
        )}
      </View>

      {(results.length > 0 || error) && (
        <View style={[styles.results, { backgroundColor: theme.background }]}>
          {results.map((result) => (
            <Pressable
              key={result.id}
              accessibilityRole="button"
              accessibilityLabel={result.label}
              onPress={() => handleSelect(result)}
              style={({ pressed }) => [
                styles.resultRow,
                {
                  backgroundColor: pressed
                    ? theme.backgroundSelected
                    : theme.background,
                },
              ]}>
              <View style={styles.resultText}>
                <Text
                  numberOfLines={1}
                  style={[styles.resultLabel, { color: theme.text }]}>
                  {result.label}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.resultHint, { color: theme.textSecondary }]}>
                  {result.description ? `${result.description} · ` : ''}
                  {result.distanceMeters != null
                    ? formatDistance(result.distanceMeters)
                    : 'OpenStreetMap'}
                </Text>
              </View>
              <Text style={[styles.resultAction, { color: theme.textSecondary }]}>
                Show
              </Text>
            </Pressable>
          ))}

          {error && results.length === 0 && (
            <Text style={[styles.error, { color: theme.textSecondary }]}>
              {error}
            </Text>
          )}

          {results.length > 0 && (
            <Text style={[styles.attribution, { color: theme.textSecondary }]}>
              Search © OpenStreetMap contributors
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  searchRow: {
    alignItems: 'center',
    borderRadius: Spacing.four,
    elevation: 5,
    flexDirection: 'row',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
  },
  input: {
    borderRadius: Spacing.four,
    flex: 1,
    fontSize: 15,
    minHeight: 42,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  clearButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  clearText: {
    fontSize: 16,
    fontWeight: '600',
  },
  spinner: {
    marginRight: Spacing.two,
  },
  results: {
    borderRadius: Spacing.three,
    elevation: 5,
    maxHeight: 340,
    overflow: 'hidden',
    paddingVertical: Spacing.one,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
  },
  resultRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  resultText: {
    flex: 1,
    gap: 2,
  },
  resultLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  resultHint: {
    fontSize: 12,
  },
  resultAction: {
    fontSize: 12,
    fontWeight: '700',
  },
  error: {
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  attribution: {
    fontSize: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    textAlign: 'right',
  },
});
