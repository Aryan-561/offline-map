# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **src/app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Navigation setup

Navigation uses the online Valhalla HTTP API. Set the public Expo environment
variable before starting the development server:

```bash
EXPO_PUBLIC_VALHALLA_URL=https://your-valhalla-server.example.com bunx expo start
```

The navigation screen is available from the **Navigate** button on the map. It
supports:

- a search bar on the home map for nearby places by name, plus a **Navigate**
  action that opens the navigation screen with that destination selected
- map-tap destination selection, place-name search and coordinate search
  (`latitude, longitude`)
- driving (`auto`) and walking (`pedestrian`) routes
- GeoJSON route rendering, origin/destination markers and camera fitting
- foreground live navigation with map-follow mode
- Valhalla manoeuvre instructions, remaining distance/time and current road
- off-route detection with configurable thresholds and debounced rerouting
- a pluggable routing engine and search provider

Place-name search uses the OpenStreetMap-based
[Photon](https://photon.komoot.io/) geocoder by default, biased towards the
current location. Coordinate entry still works offline. Configure it with:

```bash
EXPO_PUBLIC_PLACE_SEARCH_PROVIDER=photon
EXPO_PUBLIC_PLACE_SEARCH_URL=https://photon.komoot.io/api
```

To use Nominatim instead, set
`EXPO_PUBLIC_PLACE_SEARCH_PROVIDER=nominatim`,
`EXPO_PUBLIC_PLACE_SEARCH_URL=https://nominatim.openstreetmap.org` and
`EXPO_PUBLIC_PLACE_SEARCH_EMAIL=you@example.com`.

Both public instances are rate-limited and not intended for production traffic;
point `EXPO_PUBLIC_PLACE_SEARCH_URL` at a self-hosted instance before shipping.

Routing packages include an optional `places.sqlite` SQLite FTS5 index. When a
downloaded package contains it, place-name search queries the local index first
(restricted to regions covering the current location) and falls back to the
configured online geocoder only when the index returns nothing. Packages built
before this index existed must be backfilled (or rebuilt) and re-downloaded
before offline search works; see `tools/routing-data/README.md`.
`setDestinationSearchProvider` still lets you replace the whole search chain
without changing the UI.

Navigation tuning lives in
`src/features/navigation/config.ts` (off-route threshold, confirmation samples,
confirmation time and reroute cooldown).

### Offline routing is separate from offline maps

MapLibre offline packs only contain map-rendering resources (tiles, glyphs,
sprites and style). They do **not** contain a routing graph. Downloading a map
region is therefore not enough on its own: the combined region flow downloads
a Valhalla routing package for the same bounds at the same time.

The routing layer uses the `RoutingEngine` interface in
`src/features/navigation/services/routingService.ts`. Online navigation uses
`OnlineValhallaRoutingEngine`; offline regions activate the local engine through
`src/features/navigation/services/localValhallaAdapter.ts`.

The Android development build contains a local Expo module at
`modules/valhalla-engine`, backed by
[Valhalla Mobile](https://github.com/Rallista/valhalla-mobile) 0.6.4 (Valhalla
3.9.1). It loads the installed routing package's `valhalla-tiles/` directory and
answers route requests locally. The bridge is registered at app startup; if it
is absent (Expo Go, web, or iOS), the app reports that offline routing is
unavailable and never falls back to the network.

Routing data comes from the contract in `tools/routing-data/README.md`. Copy
`.env.example` to `.env` and set:

```bash
EXPO_PUBLIC_ROUTING_DATA_BASE_URL=http://<your-lan-ip>:8787
EXPO_PUBLIC_VALHALLA_ENGINE_VERSION=3.9.1
```

Start the routing-data service in a second terminal before downloading a region:

```bash
bun run routing-data
```

Keep the phone and computer on the same Wi-Fi network. The URL in
`EXPO_PUBLIC_ROUTING_DATA_BASE_URL` must use the computer's LAN IP, not
`localhost` or `127.0.0.1`. If the service is running but the phone still
cannot connect, allow TCP port `8787` through the computer's firewall.

A region is marked navigation-ready only when both datasets are installed and
checksum-verified and the native bridge is registered. Verify actual routing on
a physical device with the network disabled.

iOS offline routing still needs a macOS prebuild and a Swift wrapper around the
valhalla-mobile SPM product (iOS 16.4+).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **example** directory and create a blank **src/app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
