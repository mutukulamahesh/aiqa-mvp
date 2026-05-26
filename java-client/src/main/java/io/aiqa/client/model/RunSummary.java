package io.aiqa.client.model;

public final class RunSummary {
    private final int passed;
    private final int failed;
    private final int total;

    public RunSummary(int passed, int failed, int total) {
        this.passed = passed;
        this.failed = failed;
        this.total  = total;
    }

    public int getPassed() { return passed; }
    public int getFailed() { return failed; }
    public int getTotal()  { return total;  }

    @Override
    public String toString() {
        return "RunSummary{passed=" + passed + ", failed=" + failed + ", total=" + total + "}";
    }
}
