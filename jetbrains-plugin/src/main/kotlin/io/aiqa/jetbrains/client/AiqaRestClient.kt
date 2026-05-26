package io.aiqa.jetbrains.client

import com.intellij.openapi.diagnostic.logger
import io.aiqa.jetbrains.settings.AiqaSettingsState
import org.json.JSONObject
import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

data class RunAccepted(val runId: String)
data class RunSummary(val passed: Int, val failed: Int, val total: Int)
data class RunMeta(
    val runId: String,
    val type: String,
    val status: String,
    val summary: RunSummary?,
    val completedAt: String?,
) {
    val isFinished get() = status in setOf("passed", "failed", "error", "cancelled")
    val isPassed   get() = status == "passed"
}

class AiqaRestClient {
    private val log    = logger<AiqaRestClient>()
    private val http   = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
    private val config get() = AiqaSettingsState.instance

    fun runFile(filePath: String): RunAccepted {
        val body = JSONObject().apply {
            put("file",     filePath)
            put("env",      "dev")
            put("headless", config.headless)
        }
        return RunAccepted(post("/api/run", body).getString("runId"))
    }

    fun getRun(runId: String): RunMeta = parseMeta(get("/api/runs/$runId"))

    fun health(): String = get("/api/health").optString("status", "unknown")

    private fun post(path: String, body: JSONObject): JSONObject {
        val data = body.toString().toByteArray()
        val req  = baseRequest(path)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofByteArray(data))
            .build()
        return send(req)
    }

    private fun get(path: String): JSONObject {
        val req = baseRequest(path).GET().build()
        return send(req)
    }

    private fun baseRequest(path: String): HttpRequest.Builder {
        val url = config.serverUrl.trimEnd('/') + path
        val b   = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofSeconds(30))
            .header("Accept", "application/json")
        val key = config.apiKey
        if (key.isNotBlank()) b.header("Authorization", "Bearer $key")
        return b
    }

    private fun send(req: HttpRequest): JSONObject {
        return try {
            val resp = http.send(req, HttpResponse.BodyHandlers.ofString())
            val json = JSONObject(resp.body())
            if (resp.statusCode() >= 400) {
                val msg = json.optString("error", resp.body())
                throw IOException("AIQA server error ${resp.statusCode()}: $msg")
            }
            json
        } catch (e: IOException) {
            log.warn("AIQA request failed: ${e.message}")
            throw e
        }
    }

    private fun parseMeta(o: JSONObject): RunMeta {
        val s = o.optJSONObject("summary")
        val summary = s?.let { RunSummary(it.getInt("passed"), it.getInt("failed"), it.getInt("total")) }
        return RunMeta(
            runId       = o.optString("runId"),
            type        = o.optString("type"),
            status      = o.optString("status"),
            summary     = summary,
            completedAt = o.optString("completedAt").ifBlank { null },
        )
    }
}
