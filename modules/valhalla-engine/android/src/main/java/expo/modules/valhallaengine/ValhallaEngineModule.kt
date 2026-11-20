package expo.modules.valhallaengine

import android.content.Context
import com.squareup.moshi.Moshi
import com.valhalla.valhalla.Valhalla
import com.valhalla.valhalla.config.ValhallaConfigFactory
import com.valhalla.valhalla.config.ValhallaConfigManager
import com.valhalla.valhalla.files.ValhallaFile
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.URI

/**
 * Loads one Valhalla tile set at a time and answers route requests from it.
 *
 * The tile directory is taken from the installed routing package. The package's
 * downloaded valhalla.json is intentionally not used: it contains portable
 * relative paths, while valhalla-mobile needs absolute, device-specific paths.
 */
class ValhallaEngineModule : Module() {
  private val lock = Any()
  private val requestAdapter = Moshi.Builder().build().adapter(Any::class.java)
  private var engine: Valhalla? = null

  override fun definition() = ModuleDefinition {
    Name("ValhallaEngine")

    AsyncFunction("initialize") { options: Map<String, Any?> ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("The Android context is not available.")

      val regionId = stringOption(options, "regionId")
      val tileDirectory = File(toAbsolutePath(stringOption(options, "tilePath")))

      if (!tileDirectory.isDirectory) {
        throw IllegalStateException(
          "The installed Valhalla tile directory does not exist: ${tileDirectory.path}",
        )
      }

      synchronized(lock) {
        closeEngine()

        val baseConfig = ValhallaConfigFactory.usingTilesDir(tileDirectory.absolutePath)
        val config = baseConfig.copy(
          mjolnir =
            baseConfig.mjolnir?.copy(
              tileExtract = null,
              trafficExtract = null,
            ),
        )
        val configFile = ValhallaFile(context, configFileName(regionId))
        val manager = ValhallaConfigManager(context, configFile)

        engine = Valhalla(context, config, manager)
      }
    }

    AsyncFunction("route") { request: Map<String, Any?> ->
      val requestJson = requestAdapter.toJson(request)

      synchronized(lock) {
        val current = engine
          ?: throw IllegalStateException(
            "The Valhalla engine is not initialized. Install and select an offline region first.",
          )

        current.routeRaw(requestJson)
      }
    }

    AsyncFunction("isInitialized") {
      synchronized(lock) { engine != null }
    }

    AsyncFunction("dispose") {
      synchronized(lock) { closeEngine() }
    }

    OnDestroy {
      synchronized(lock) { closeEngine() }
    }
  }

  private fun closeEngine() {
    engine?.close()
    engine = null
  }

  private fun stringOption(options: Map<String, Any?>, key: String): String {
    val value = options[key] as? String

    if (value.isNullOrBlank()) {
      throw IllegalArgumentException("Missing $key.")
    }

    return value
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

  private fun configFileName(regionId: String): String =
    "valhalla-${regionId.replace(Regex("[^A-Za-z0-9._-]"), "_")}.json"
}
