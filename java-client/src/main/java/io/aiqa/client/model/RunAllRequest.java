package io.aiqa.client.model;

import java.util.List;
import java.util.Map;

/** Request body for POST /api/run-all. */
public final class RunAllRequest {
    private String              dir      = "tests";
    private String              env      = "dev";
    private boolean             headless = true;
    private int                 workers  = 1;
    private List<String>        tags;
    private Map<String, String> vars;

    private RunAllRequest() {}

    public static Builder builder() { return new Builder(); }

    public String              getDir()      { return dir;      }
    public String              getEnv()      { return env;      }
    public boolean             isHeadless()  { return headless; }
    public int                 getWorkers()  { return workers;  }
    public List<String>        getTags()     { return tags;     }
    public Map<String, String> getVars()     { return vars;     }

    public static final class Builder {
        private final RunAllRequest r = new RunAllRequest();
        public Builder dir(String v)               { r.dir      = v; return this; }
        public Builder env(String v)               { r.env      = v; return this; }
        public Builder headless(boolean v)         { r.headless = v; return this; }
        public Builder workers(int v)              { r.workers  = v; return this; }
        public Builder tags(List<String> v)        { r.tags     = v; return this; }
        public Builder vars(Map<String, String> v) { r.vars     = v; return this; }
        public RunAllRequest build()               { return r;       }
    }
}
