package io.aiqa.maven;

import org.apache.maven.plugin.AbstractMojo;
import org.apache.maven.plugin.MojoExecutionException;
import org.apache.maven.plugins.annotations.LifecyclePhase;
import org.apache.maven.plugins.annotations.Mojo;
import org.apache.maven.plugins.annotations.Parameter;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Runs an AIQA test suite via the Node CLI or Docker fallback.
 *
 * Usage:
 *   mvn aiqa:run
 *   mvn aiqa:run -Daiqa.testPath=tests/smoke/ -Daiqa.headless=true
 *
 * Plugin config in pom.xml:
 *   <plugin>
 *     <groupId>io.aiqa</groupId>
 *     <artifactId>aiqa-maven-plugin</artifactId>
 *     <version>1.0.0</version>
 *     <configuration>
 *       <testPath>tests/</testPath>
 *       <headless>true</headless>
 *       <workers>2</workers>
 *       <env>staging</env>
 *     </configuration>
 *   </plugin>
 */
@Mojo(name = "run", defaultPhase = LifecyclePhase.INTEGRATION_TEST)
public class AiqaRunMojo extends AbstractMojo {

    /** Path to the YAML test file or directory of test files. */
    @Parameter(property = "aiqa.testPath", defaultValue = "tests/")
    private String testPath;

    /** Run the browser in headless mode (recommended for CI). */
    @Parameter(property = "aiqa.headless", defaultValue = "true")
    private boolean headless;

    /** Number of tests to run in parallel. */
    @Parameter(property = "aiqa.workers", defaultValue = "1")
    private int workers;

    /** Environment profile to load (dev | staging | prod). */
    @Parameter(property = "aiqa.env", defaultValue = "dev")
    private String env;

    /**
     * Comma-separated tags — only tests whose tags include at least one of
     * these will run. Leave blank to run all tests.
     */
    @Parameter(property = "aiqa.tags", defaultValue = "")
    private String tags;

    /** Abort the suite after N consecutive failures. */
    @Parameter(property = "aiqa.circuitBreaker", defaultValue = "0")
    private int circuitBreaker;

    /** Skip execution entirely (e.g. -Daiqa.skip=true). */
    @Parameter(property = "aiqa.skip", defaultValue = "false")
    private boolean skip;

    /** Fail the Maven build when tests fail. Set false to collect results without breaking the build. */
    @Parameter(property = "aiqa.failBuild", defaultValue = "true")
    private boolean failBuild;

    @Override
    public void execute() throws MojoExecutionException {
        if (skip) {
            getLog().info("[AIQA] Skipping execution (aiqa.skip=true)");
            return;
        }

        List<String> command = buildCommand();
        getLog().info("[AIQA] Running: " + String.join(" ", command));

        try {
            ProcessBuilder pb = new ProcessBuilder(command);
            pb.inheritIO();
            pb.environment().putAll(System.getenv());

            int exitCode = pb.start().waitFor();

            if (exitCode != 0 && failBuild) {
                throw new MojoExecutionException(
                    "[AIQA] Tests failed (exit code " + exitCode + "). " +
                    "Set <failBuild>false</failBuild> to collect results without breaking the build."
                );
            }
        } catch (IOException e) {
            throw new MojoExecutionException("[AIQA] Failed to launch test runner: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new MojoExecutionException("[AIQA] Interrupted while waiting for test runner", e);
        }
    }

    private List<String> buildCommand() {
        if (isCommandAvailable("aiqa")) {
            return buildNodeCommand();
        }
        if (isCommandAvailable("docker")) {
            getLog().info("[AIQA] 'aiqa' CLI not found — falling back to Docker");
            return buildDockerCommand();
        }
        // Return the Node command anyway so the error message from the OS is clear
        getLog().warn("[AIQA] Neither 'aiqa' CLI nor 'docker' found. Install AIQA: " +
            "curl -fsSL https://raw.githubusercontent.com/mutukulamahesh/aiqa-mvp/main/install.sh | bash");
        return buildNodeCommand();
    }

    private List<String> buildNodeCommand() {
        List<String> cmd = new ArrayList<>(Arrays.asList("aiqa", "--env", env, "run-all", testPath));
        if (headless)           cmd.add("--headless");
        if (workers > 1)        cmd.addAll(Arrays.asList("--workers", String.valueOf(workers)));
        if (!tags.isBlank())    cmd.addAll(Arrays.asList("--tags", tags));
        if (circuitBreaker > 0) cmd.addAll(Arrays.asList("--circuit-breaker", String.valueOf(circuitBreaker)));
        return cmd;
    }

    private List<String> buildDockerCommand() {
        String absTestPath = new File(testPath).isAbsolute()
            ? testPath
            : new File(System.getProperty("user.dir"), testPath).getAbsolutePath();

        List<String> cmd = new ArrayList<>(Arrays.asList(
            "docker", "run", "--rm",
            "-v", absTestPath + ":/tests",
            "aiqa/aiqa",
            "--env", env,
            "run-all", "/tests",
            "--headless"
        ));
        if (workers > 1)        cmd.addAll(Arrays.asList("--workers", String.valueOf(workers)));
        if (!tags.isBlank())    cmd.addAll(Arrays.asList("--tags", tags));
        if (circuitBreaker > 0) cmd.addAll(Arrays.asList("--circuit-breaker", String.valueOf(circuitBreaker)));
        return cmd;
    }

    private static boolean isCommandAvailable(String command) {
        String pathEnv = System.getenv("PATH");
        if (pathEnv == null) return false;
        String separator = File.pathSeparator;
        String execSuffix = System.getProperty("os.name", "").toLowerCase().contains("win") ? ".cmd" : "";
        for (String dir : pathEnv.split(separator)) {
            File f = new File(dir, command + execSuffix);
            if (f.canExecute()) return true;
            if (execSuffix.isEmpty()) {
                // Also check .exe on Windows
                File exe = new File(dir, command + ".exe");
                if (exe.canExecute()) return true;
            }
        }
        return false;
    }
}
