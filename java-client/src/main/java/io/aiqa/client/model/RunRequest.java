package io.aiqa.client.model;

import java.util.List;
import java.util.Map;

/** Request body for POST /api/run (single test). Either file or content must be set. */
public final class RunRequest {
    private String              file;
    private String              content;
    private String              env      = "dev";
    private boolean             headless = true;
    private List<String>        tags;
    private Map<String, String> vars;

    private RunRequest() {}

    public static Builder builder() { return new Builder(); }

    /** Convenience: run a single YAML file by server-side path. */
    public static RunRequest ofFile(String file) {
        return builder().file(file).build();
    }

    /** Convenience: run inline YAML content. */
    public static RunRequest ofContent(String yamlContent) {
        return builder().content(yamlContent).build();
    }

    public String              getFile()     { return file;     }
    public String              getContent()  { return content;  }
    public String              getEnv()      { return env;      }
    public boolean             isHeadless()  { return headless; }
    public List<String>        getTags()     { return tags;     }
    public Map<String, String> getVars()     { return vars;     }

    public static final class Builder {
        private final RunRequest r = new RunRequest();
        public Builder file(String v)                    { r.file     = v; return this; }
        public Builder content(String v)                 { r.content  = v; return this; }
        public Builder env(String v)                     { r.env      = v; return this; }
        public Builder headless(boolean v)               { r.headless = v; return this; }
        public Builder tags(List<String> v)              { r.tags     = v; return this; }
        public Builder vars(Map<String, String> v)       { r.vars     = v; return this; }
        public RunRequest build() {
            if (r.file == null && r.content == null)
                throw new IllegalStateException("Either file or content must be set");
            return r;
        }
    }
}
