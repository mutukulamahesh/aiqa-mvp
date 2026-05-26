package io.aiqa.client.model;

import java.util.Set;

public final class RunMeta {
    private static final Set<String> TERMINAL = Set.of("passed", "failed", "error", "cancelled");

    private final String     runId;
    private final String     type;
    private final String     status;
    private final RunSummary summary;
    private final String     completedAt;

    public RunMeta(String runId, String type, String status, RunSummary summary, String completedAt) {
        this.runId       = runId;
        this.type        = type;
        this.status      = status;
        this.summary     = summary;
        this.completedAt = completedAt;
    }

    public String     getRunId()       { return runId;       }
    public String     getType()        { return type;        }
    public String     getStatus()      { return status;      }
    public RunSummary getSummary()     { return summary;     }
    public String     getCompletedAt() { return completedAt; }

    public boolean isPassed()   { return "passed".equals(status); }
    public boolean isFinished() { return TERMINAL.contains(status); }

    @Override
    public String toString() {
        return "RunMeta{runId='" + runId + "', status='" + status + "', summary=" + summary + "}";
    }
}
