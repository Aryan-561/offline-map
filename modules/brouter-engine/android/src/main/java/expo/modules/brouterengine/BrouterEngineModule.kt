package expo.modules.brouterengine

import android.content.Context
import btools.router.FormatJson
import btools.router.OsmTrack
import btools.router.RoutingContext
import btools.router.RoutingEngine
import btools.router.RoutingParamCollector
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.util.concurrent.Executors

class BrouterEngineModule : Module() {
  private val executor = Executors.newSingleThreadExecutor()
  private var segmentDir: File? = null
  private var profileDir: File? = null

  override fun definition() = ModuleDefinition {
    Name("BrouterEngine")

    AsyncFunction("initialize") { options: Map<String, Any?> ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("The Android context is not available.")

      val segments = File(toAbsolutePath(stringOption(options, "segmentDir")))

      if (!segments.isDirectory) {
        throw IllegalStateException(
          "The BRouter segment directory does not exist: ${segments.path}",
        )
      }

      val profiles = File(context.filesDir, "brouter/profiles")
      copyBundledProfiles(context, profiles)

      executor.submit {
        System.setProperty("segmentBaseDir", segments.absolutePath)
        System.setProperty("profileBaseDir", profiles.absolutePath)
        segmentDir = segments
        profileDir = profiles
      }.get()
    }

    AsyncFunction("route") { request: Map<String, Any?> ->
      executor.submit<String> {
        val segments = segmentDir
          ?: throw IllegalStateException(
            "The BRouter engine is not initialized. Download an offline region first.",
          )
        val profiles = profileDir
          ?: throw IllegalStateException("The BRouter profiles are not installed.")

        val origin = mapOption(request, "origin")
        val destination = mapOption(request, "destination")
        val profile = stringOption(request, "profile")
        val timeoutMs = numberOption(request, "timeoutMs", 60_000.0)
          .toLong()
          .coerceIn(5_000L, 300_000L)

        if (!File(profiles, "$profile.brf").isFile) {
          throw IllegalArgumentException("BRouter profile not found: $profile")
        }

        val lonlats = buildString {
          append(doubleOption(origin, "longitude"))
          append(',')
          append(doubleOption(origin, "latitude"))
          append('|')
          append(doubleOption(destination, "longitude"))
          append(',')
          append(doubleOption(destination, "latitude"))
        }

        val waypoints = RoutingParamCollector().getWayPointList(lonlats)
        val routingContext = RoutingContext()
        routingContext.localFunction = profile
        routingContext.turnInstructionMode = 1

        val engine = RoutingEngine(
          null,
          null,
          segments,
          waypoints,
          routingContext,
          0,
        )
        engine.quite = true
        engine.doRun(timeoutMs)

        engine.errorMessage?.let { message ->
          throw IllegalStateException(message)
        }

        val track = engine.foundTrack as? OsmTrack
          ?: throw IllegalStateException("BRouter did not return a route.")

        track.exportWaypoints = false
        FormatJson(routingContext).format(track)
      }.get()
    }

    AsyncFunction("isInitialized") {
      segmentDir != null && profileDir != null
    }

    AsyncFunction("dispose") {
      executor.submit {
        segmentDir = null
        profileDir = null
      }.get()
    }

    OnDestroy {
      segmentDir = null
      profileDir = null
    }
  }

  private fun copyBundledProfiles(context: Context, target: File) {
    if (!target.exists() && !target.mkdirs()) {
      throw IllegalStateException("Unable to create the BRouter profile directory.")
    }

    val assets = context.assets.list("brouter/profiles") ?: emptyArray()

    for (name in assets) {
      val destination = File(target, name)
      context.assets.open("brouter/profiles/$name").use { input ->
        FileOutputStream(destination).use { output ->
          input.copyTo(output)
        }
      }
    }
  }

  private fun stringOption(options: Map<String, Any?>, key: String): String {
    val value = options[key] as? String

    if (value.isNullOrBlank()) {
      throw IllegalArgumentException("Missing $key.")
    }

    return value
  }

  @Suppress("UNCHECKED_CAST")
  private fun mapOption(options: Map<String, Any?>, key: String): Map<String, Any?> {
    val value = options[key] as? Map<*, *>

    if (value == null) {
      throw IllegalArgumentException("Missing $key.")
    }

    return value as Map<String, Any?>
  }

  private fun doubleOption(options: Map<String, Any?>, key: String): Double {
    val value = (options[key] as? Number)?.toDouble()

    if (value == null || !value.isFinite()) {
      throw IllegalArgumentException("Missing or invalid $key.")
    }

    return value
  }

  private fun numberOption(
    options: Map<String, Any?>,
    key: String,
    fallback: Double,
  ): Double {
    return (options[key] as? Number)?.toDouble()?.takeIf { it.isFinite() } ?: fallback
  }

  private fun toAbsolutePath(value: String): String {
    if (!value.startsWith("file://")) {
      return value
    }

    return try {
      File(URI(value)).absolutePath
    } catch (_: Exception) {
      value.removePrefix("file://")
    }
  }
}
