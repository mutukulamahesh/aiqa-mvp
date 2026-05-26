package io.aiqa.client;

import io.aiqa.client.exception.AiqaException;
import io.aiqa.client.exception.AiqaTimeoutException;
import io.aiqa.client.model.RunAllRequest;
import io.aiqa.client.model.RunMeta;
import io.aiqa.client.model.RunRequest;
import io.aiqa.client.model.RunSummary;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Java client for the AIQA REST API.
 *
 * <p>Quick start:
 * <pre>{@code
 * AiqaClient client = AiqaClient.builder()
 *     .baseUrl("http://localhost:7432")
 *     .apiKey("your-key")
 *     .build();
 *
 * String runId = client.runAll(RunAllRequest.builder()
 *     .dir("tests/")
 *     .headless(true)
 *     .workers(2)
 *     .build());
 *
 * RunMeta result = client.waitForRun(runId, Duration.ofMinutes(5));
 * System.out.println(result.isPassed() ? "PASSED" : "FAILED: " + result.getSummary());
 * }</pre>
 *
 * <p>Requires Java 11+ (uses {@code java.net.http.HttpClient}).
 */
public final class AiqaClient {

    private final String     baseUrl;
    private final String     apiKey;
    private final HttpClient http;
    private final Duration   requestTimeout;

    private AiqaClient(Builder b) {
        this.baseUrl        = b.baseUrl.replaceAll("/+$", "");
        this.apiKey         = b.apiKey;
        this.requestTimeout = b.requestTimeout;
        this.http           = HttpClient.newBuilder()
            .connectTimeout(b.requestTimeout)
            .build();
    }

    public static Builder builder() { return new Builder(); }

    // ── Trigger endpoints ──────────────────────────────────────────────────────

    /** Submit a single test. Returns the runId. */
    public String run(RunRequest req) {
        JSONObject body = new JSONObject();
        body.put("env",      req.getEnv());
        body.put("headless", req.isHeadless());
        if (req.getFile()    != null) body.put("file",    req.getFile());
        if (req.getContent() != null) body.put("content", req.getContent());
        if (req.getTags()    != null) body.put("tags",    req.getTags());
        if (req.getVars()    != null) body.put("vars",    new JSONObject(req.getVars()));
        return post("/api/run", body).getString("runId");
    }

    /** Submit a full test suite directory. Returns the runId. */
    public String runAll(RunAllRequest req) {
        JSONObject body = new JSONObject();
        body.put("dir",      req.getDir());
        body.put("env",      req.getEnv());
        body.put("headless", req.isHeadless());
        body.put("workers",  req.getWorkers());
        if (req.getTags() != null) body.put("tags", req.getTags());
        if (req.getVars() != null) body.put("vars", new JSONObject(req.getVars()));
        return post("/api/run-all", body).getString("runId");
    }

    /** Cancel a running or queued job. */
    public RunMeta cancel(String runId) {
        return parseRunMeta(post("/api/runs/" + runId + "/cancel", new JSONObject()));
    }

    // ── Query endpoints ────────────────────────────────────────────────────────

    /** Fetch run metadata. */
    public RunMeta getRun(String runId) {
        return parseRunMeta(get("/api/runs/" + runId));
    }

    /** List recent runs. */
    public List<RunMeta> listRuns(int limit) {
        JSONArray arr = getArray("/api/runs?limit=" + limit);
        List<RunMeta> result = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) result.add(parseRunMeta(arr.getJSONObject(i)));
        return result;
    }

    /** Fetch raw results JSON for a completed run. */
    public JSONObject getResults(String runId) {
        return get("/api/runs/" + runId + "/results");
    }

    /** Health check — does not require an API key. */
    public JSONObject health() {
        return getUnauthenticated("/api/health");
    }

    // ── Polling helper ─────────────────────────────────────────────────────────

    /**
     * Polls until the run is in a terminal state or the timeout expires.
     * Uses capped exponential back-off (2s → 4s → 8s … → 10s).
     *
     * @throws AiqaTimeoutException if the run does not finish within timeout.
     * @throws AiqaException        on server errors while polling.
     */
    public RunMeta waitForRun(String runId, Duration timeout) {
        long deadlineNs = System.nanoTime() + timeout.toNanos();
        long intervalMs = 2_000;
        while (true) {
            RunMeta meta = getRun(runId);
            if (meta.isFinished()) return meta;
            long remainingMs = (deadlineNs - System.nanoTime()) / 1_000_000;
            if (remainingMs <= 0) {
                throw new AiqaTimeoutException(
                    "Run " + runId + " did not finish within " + timeout + " (last status: " + meta.getStatus() + ")"
                );
            }
            try {
                Thread.sleep(Math.min(intervalMs, remainingMs));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new AiqaException("Interrupted while waiting for run " + runId);
            }
            intervalMs = Math.min(intervalMs * 2, 10_000);
        }
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    private JSONObject post(String path, JSONObject body) {
        HttpRequest.Builder req = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + path))
            .timeout(requestTimeout)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body.toString()));
        if (apiKey != null) req.header("Authorization", "Bearer " + apiKey);
        return send(req.build());
    }

    private JSONObject get(String path) {
        HttpRequest.Builder req = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + path))
            .timeout(requestTimeout)
            .header("Accept", "application/json")
            .GET();
        if (apiKey != null) req.header("Authorization", "Bearer " + apiKey);
        return send(req.build());
    }

    private JSONArray getArray(String path) {
        HttpRequest.Builder req = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + path))
            .timeout(requestTimeout)
            .header("Accept", "application/json")
            .GET();
        if (apiKey != null) req.header("Authorization", "Bearer " + apiKey);
        return sendArray(req.build());
    }

    private JSONObject getUnauthenticated(String path) {
        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + path))
            .timeout(requestTimeout)
            .header("Accept", "application/json")
            .GET()
            .build();
        return send(req);
    }

    private JSONObject send(HttpRequest req) {
        try {
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            JSONObject json = new JSONObject(resp.body());
            if (resp.statusCode() >= 400) {
                String msg = json.optString("error", resp.body());
                throw new AiqaException(msg, resp.statusCode());
            }
            return json;
        } catch (IOException e) {
            throw new AiqaException("Cannot reach AIQA server at " + baseUrl + ": " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AiqaException("Request interrupted");
        }
    }

    private JSONArray sendArray(HttpRequest req) {
        try {
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() >= 400) {
                String msg;
                try { msg = new JSONObject(resp.body()).optString("error", resp.body()); }
                catch (Exception ignored) { msg = resp.body(); }
                throw new AiqaException(msg, resp.statusCode());
            }
            return new JSONArray(resp.body());
        } catch (IOException e) {
            throw new AiqaException("Cannot reach AIQA server at " + baseUrl + ": " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AiqaException("Request interrupted");
        }
    }

    private static RunMeta parseRunMeta(JSONObject o) {
        RunSummary summary = null;
        if (o.has("summary") && !o.isNull("summary")) {
            JSONObject s = o.getJSONObject("summary");
            summary = new RunSummary(s.getInt("passed"), s.getInt("failed"), s.getInt("total"));
        }
        return new RunMeta(
            o.optString("runId", ""),
            o.optString("type",  ""),
            o.optString("status", ""),
            summary,
            o.optString("completedAt", null)
        );
    }

    // ── Builder ────────────────────────────────────────────────────────────────

    public static final class Builder {
        private String   baseUrl        = "http://localhost:7432";
        private String   apiKey         = null;
        private Duration requestTimeout = Duration.ofSeconds(30);

        public Builder baseUrl(String v)        { this.baseUrl        = v; return this; }
        public Builder apiKey(String v)         { this.apiKey         = v; return this; }
        public Builder requestTimeout(Duration v){ this.requestTimeout = v; return this; }
        public AiqaClient build()               { return new AiqaClient(this); }
    }
}
